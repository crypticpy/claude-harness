import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  writeEvent,
  readEvents,
  mirrorToolEvent,
  eventsFile,
  pruneEvents,
  checkpointsFile,
  pruneCheckpoints,
  classifyBashCommand,
  recordMemoryRecall,
  countMemoryRecalls,
} from "../../../hooks/unified/modules/event-writer.mjs";

let projectDir: string;
const EVT_ID = /^evt_[A-Za-z0-9_-]+$/;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-evt-"));
});
afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("writeEvent", () => {
  it("assigns an evt_ id, ts, and appends valid JSONL", () => {
    const e: any = writeEvent(
      {
        sessionId: "s1",
        kind: "edit",
        tool: "Edit",
        files: ["a.ts"],
        outcome: "ok",
      },
      { projectDir },
    );
    expect(e).not.toBeNull();
    expect(e.id).toMatch(EVT_ID);
    expect(typeof e.ts).toBe("string");

    const file = eventsFile(projectDir);
    expect(fs.existsSync(file)).toBe(true);
    const written = JSON.parse(fs.readFileSync(file, "utf-8").trim());
    expect(written.kind).toBe("edit");
    expect(written.files).toEqual(["a.ts"]);
  });

  it("coerces invalid kind/outcome/risk to safe defaults", () => {
    const e: any = writeEvent(
      { sessionId: "s1", kind: "bogus", outcome: "nope", risk: "spicy" },
      { projectDir },
    );
    expect(e.kind).toBe("tool_call");
    expect(e.outcome).toBe("ok");
    expect(e.risk).toBeNull();
  });

  it("gives distinct ids to same-content events", () => {
    const a: any = writeEvent(
      { sessionId: "s", kind: "read", files: ["x.ts"] },
      { projectDir },
    );
    const b: any = writeEvent(
      { sessionId: "s", kind: "read", files: ["x.ts"] },
      { projectDir },
    );
    expect(a.id).not.toBe(b.id);
  });
});

describe("readEvents", () => {
  it("skips corrupted lines and filters by session and sinceTs", () => {
    writeEvent(
      {
        sessionId: "s1",
        kind: "read",
        ts: "2026-01-01T00:00:00.000Z",
        files: ["a"],
      },
      { projectDir },
    );
    writeEvent(
      {
        sessionId: "s1",
        kind: "edit",
        ts: "2026-02-01T00:00:00.000Z",
        files: ["b"],
      },
      { projectDir },
    );
    writeEvent(
      {
        sessionId: "s2",
        kind: "edit",
        ts: "2026-02-01T00:00:00.000Z",
        files: ["c"],
      },
      { projectDir },
    );
    // Inject a corrupt line.
    fs.appendFileSync(eventsFile(projectDir), "{ not json\n");

    const all = readEvents(projectDir, { sessionId: "s1" });
    expect(all).toHaveLength(2);

    const recent = readEvents(projectDir, {
      sessionId: "s1",
      sinceTs: "2026-01-15T00:00:00.000Z",
    });
    expect(recent).toHaveLength(1);
    expect(recent[0].files).toEqual(["b"]);
  });

  it("returns [] when the ledger does not exist", () => {
    expect(readEvents(projectDir)).toEqual([]);
  });
});

describe("mirrorToolEvent", () => {
  it("maps an Edit into an edit event with the file", () => {
    const e: any = mirrorToolEvent(
      {
        session_id: "s",
        tool_name: "Edit",
        tool_input: { file_path: "src/app.ts" },
        tool_output: "ok",
      },
      { projectDir },
    );
    expect(e.kind).toBe("edit");
    expect(e.files).toEqual(["src/app.ts"]);
    expect(e.outcome).toBe("ok");
    // summary echoes the file path once — not a doubled extension (app.ts.ts)
    expect(e.summary).toBe("Edit src/app.ts");
  });

  it("classifies a test command as a test event", () => {
    const e: any = mirrorToolEvent(
      {
        session_id: "s",
        tool_name: "Bash",
        tool_input: { command: "npx vitest run" },
        tool_output: "2 passed",
      },
      { projectDir },
    );
    expect(e.kind).toBe("test");
  });

  it("classifies runners invoked at a command boundary, in any form", () => {
    const kindOf = (command: string): string =>
      (
        mirrorToolEvent(
          { session_id: "s", tool_name: "Bash", tool_input: { command } },
          { projectDir },
        ) as any
      ).kind;
    expect(kindOf("npm test")).toBe("test");
    expect(kindOf("yarn test --watch")).toBe("test");
    expect(kindOf("go test ./...")).toBe("test");
    expect(kindOf("cargo test")).toBe("test");
    expect(kindOf("pytest -q")).toBe("test");
    expect(kindOf("npx playwright test")).toBe("test");
    expect(kindOf("eslint . --fix")).toBe("lint");
    expect(kindOf("npm run typecheck")).toBe("lint");
  });

  it("does NOT classify a runner name in an echo or filename as a test", () => {
    const kindOf = (command: string): string =>
      (
        mirrorToolEvent(
          { session_id: "s", tool_name: "Bash", tool_input: { command } },
          { projectDir },
        ) as any
      ).kind;
    // The bug: substring match counted these as test runs.
    expect(
      kindOf('command git status && echo "--- VITEST CONFIG ---" && ls'),
    ).toBe("tool_call");
    expect(kindOf("cat vitest.config.ts")).toBe("tool_call");
    expect(kindOf("head -15 tests/session-checkpoint.test.ts")).toBe(
      "tool_call",
    );
    expect(kindOf("npm run build")).toBe("tool_call");
  });

  it("does NOT classify commands that merely REFERENCE test paths/words", () => {
    // Regression set for the test_command pollution bug: only an actual test
    // runner as the invoked executable/verb may classify as 'test'.
    expect(classifyBashCommand("ls src/tests")).toBe("tool_call");
    expect(classifyBashCommand("cat foo.test.ts")).toBe("tool_call");
    expect(classifyBashCommand("grep test file")).toBe("tool_call");
    expect(classifyBashCommand("mkdir tests")).toBe("tool_call");
    expect(classifyBashCommand('git commit -m "add tests"')).toBe("tool_call");
    expect(classifyBashCommand('find . -name "*.test.ts"')).toBe("tool_call");
    expect(classifyBashCommand("ls | grep test")).toBe("tool_call");
    // Runner-name-PREFIXED executables are not the runner itself.
    expect(classifyBashCommand("time pytest-helper.sh")).toBe("tool_call");
    expect(classifyBashCommand("jest-codemods run")).toBe("tool_call");
    expect(classifyBashCommand("vitest-preview")).toBe("tool_call");
  });

  it("classifies real test runners, including compound commands", () => {
    expect(classifyBashCommand("cd x && npx vitest run")).toBe("test");
    expect(classifyBashCommand("npx vitest run")).toBe("test");
    expect(classifyBashCommand("vitest")).toBe("test");
    expect(classifyBashCommand("jest --coverage")).toBe("test");
    expect(classifyBashCommand("pytest -q")).toBe("test");
    expect(classifyBashCommand("go test ./...")).toBe("test");
    expect(classifyBashCommand("cargo test")).toBe("test");
    expect(classifyBashCommand("npm test")).toBe("test");
    expect(classifyBashCommand("pnpm test")).toBe("test");
    expect(classifyBashCommand("yarn test --watch")).toBe("test");
    expect(classifyBashCommand("bun test")).toBe("test");
    expect(classifyBashCommand("rspec spec/models")).toBe("test");
    expect(classifyBashCommand("phpunit tests/")).toBe("test");
    expect(classifyBashCommand("npm run test:unit")).toBe("test");
  });

  it("keeps the semantic kind but marks outcome=error on a failure", () => {
    const e: any = mirrorToolEvent(
      {
        session_id: "s",
        tool_name: "Bash",
        tool_input: { command: "ls" },
        tool_output: "Error: command failed",
      },
      { projectDir },
    );
    expect(e.kind).toBe("tool_call");
    expect(e.outcome).toBe("error");
  });

  it("a failing test stays kind=test with outcome=error", () => {
    const e: any = mirrorToolEvent(
      {
        session_id: "s",
        tool_name: "Bash",
        tool_input: { command: "npx vitest run" },
        tool_output: "1 failed: Error in auth",
      },
      { projectDir },
    );
    expect(e.kind).toBe("test");
    expect(e.outcome).toBe("error");
  });

  it("records a passive permission event on a denial, without altering the tool event", () => {
    mirrorToolEvent(
      {
        session_id: "s",
        tool_name: "Bash",
        tool_input: { command: "rm -rf /" },
        tool_output: "permission denied",
      },
      { projectDir },
    );
    const events = readEvents(projectDir);
    const perm = events.find((e) => e.kind === "permission");
    expect(perm).toBeDefined();
    expect(perm!.outcome).toBe("denied");
    expect(perm!.tool).toBe("Bash");
  });
});

describe("memory recall telemetry", () => {
  it("writes ONE memory_recall event per batch with meta.ids", () => {
    const e: any = recordMemoryRecall(projectDir, ["mem_a", "mem_b"], {
      via: "self-evolution",
    });
    expect(e).not.toBeNull();
    expect(e.kind).toBe("memory_recall");
    expect(e.meta.ids).toEqual(["mem_a", "mem_b"]);

    const events = readEvents(projectDir);
    expect(events).toHaveLength(1); // batch, not per-memory
    expect(events[0].kind).toBe("memory_recall");
  });

  it("no-ops on empty or invalid id lists", () => {
    expect(recordMemoryRecall(projectDir, [])).toBeNull();
    expect(recordMemoryRecall(projectDir, undefined as any)).toBeNull();
    expect(recordMemoryRecall(projectDir, [null, 42] as any)).toBeNull();
    expect(readEvents(projectDir)).toHaveLength(0);
  });

  it("countMemoryRecalls folds ids across batches", () => {
    recordMemoryRecall(projectDir, ["mem_a", "mem_b"]);
    recordMemoryRecall(projectDir, ["mem_a"]);
    const counts = countMemoryRecalls(projectDir);
    expect(counts.get("mem_a")).toBe(2);
    expect(counts.get("mem_b")).toBe(1);
    expect(counts.get("mem_missing")).toBeUndefined();
  });
});

describe("pruneEvents", () => {
  it("drops events older than the retention window", () => {
    writeEvent(
      {
        sessionId: "s",
        kind: "read",
        ts: "2000-01-01T00:00:00.000Z",
        files: ["old"],
      },
      { projectDir },
    );
    writeEvent(
      { sessionId: "s", kind: "read", files: ["fresh"] },
      { projectDir },
    ); // now
    pruneEvents(projectDir, 30);
    const remaining = readEvents(projectDir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].files).toEqual(["fresh"]);
  });

  it("caps the file size by keeping only the newest whole lines", () => {
    for (let i = 0; i < 10; i++) {
      writeEvent(
        { sessionId: "s", kind: "read", summary: `pad-${i}-${"x".repeat(400)}` },
        { projectDir },
      );
    }
    const file = eventsFile(projectDir);
    const before = fs.statSync(file).size;
    const cap = Math.floor(before / 2);

    pruneEvents(projectDir, 90, { maxBytes: cap });

    expect(fs.statSync(file).size).toBeLessThanOrEqual(cap);
    const remaining = readEvents(projectDir);
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.length).toBeLessThan(10);
    // Newest survive (whole-line boundaries — every survivor still parses).
    expect(remaining[remaining.length - 1].summary).toContain("pad-9-");
    expect(remaining[0].summary).not.toContain("pad-0-");
  });

  it("leaves a small file alone", () => {
    writeEvent({ sessionId: "s", kind: "read", files: ["a"] }, { projectDir });
    const file = eventsFile(projectDir);
    const before = fs.readFileSync(file, "utf-8");
    pruneEvents(projectDir, 90); // default 10MB cap — nothing to trim
    expect(fs.readFileSync(file, "utf-8")).toBe(before);
  });
});

describe("pruneCheckpoints", () => {
  it("drops checkpoints older than the retention window", () => {
    const file = checkpointsFile(projectDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const rows = [
      { type: "checkpoint", session_id: "s", timestamp: "2000-01-01T00:00:00.000Z", tag: "old" },
      { type: "checkpoint", session_id: "s", timestamp: new Date().toISOString(), tag: "fresh" },
    ];
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

    pruneCheckpoints(projectDir, 30);
    const kept = fs
      .readFileSync(file, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    expect(kept).toHaveLength(1);
    expect(kept[0].tag).toBe("fresh");
  });

  it("is a no-op when there is no checkpoints file", () => {
    expect(() => pruneCheckpoints(projectDir, 30)).not.toThrow();
  });
});
