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
});
