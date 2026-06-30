import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// The deterministic reducer is a hook-side ESM module one level up.
// vitest.config.ts allows fs access to the repo root for this cross-runtime import.
import {
  runReducer,
  deriveFocus,
} from "../../../hooks/unified/modules/precompact-reducer.mjs";
import {
  writeEvent,
  readEvents,
} from "../../../hooks/unified/modules/event-writer.mjs";
import {
  appendMemory,
  readMemories,
} from "../../../hooks/unified/modules/memory-store.mjs";

const LEDGER_ON = { puntax: { eventLedger: { enabled: true } } };

let projectDir: string;
let transcriptPath: string;
const savedProjectDir = process.env.CLAUDE_PROJECT_DIR;

function transcript(): string {
  const lines: unknown[] = [];
  for (let i = 0; i < 6; i++) {
    lines.push({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: { file_path: `src/mod${i}.ts` },
          },
        ],
      },
    });
    lines.push({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            content: i === 2 ? "TypeError: boom" : "ok",
            is_error: i === 2,
          },
        ],
      },
    });
  }
  return lines.map((l) => JSON.stringify(l)).join("\n");
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-reducer-"));
  process.env.CLAUDE_PROJECT_DIR = projectDir;
  transcriptPath = path.join(projectDir, "transcript.jsonl");
  fs.writeFileSync(transcriptPath, transcript());
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
  if (savedProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
  else process.env.CLAUDE_PROJECT_DIR = savedProjectDir;
});

describe("precompact-reducer (deterministic, no API key)", () => {
  it("writes a checkpoint with signals, working files, and errors", async () => {
    const checkpoint: any = await runReducer(
      { session_id: "s1", transcript_path: transcriptPath },
      {},
    );

    expect(checkpoint).not.toBeNull();
    expect(checkpoint.type).toBe("checkpoint");
    expect(checkpoint.session_id).toBe("s1");
    expect(checkpoint.signals.totalToolCalls).toBe(6);
    expect(checkpoint.signals.toolErrors).toBe(1);
    expect(checkpoint.workingFiles.length).toBeGreaterThan(0);
    expect(checkpoint.workingFiles.some((f: string) => f.endsWith(".ts"))).toBe(
      true,
    );
    expect(checkpoint.lastActions.length).toBeGreaterThan(0);

    // Persisted to <projectDir>/.claude/context-layer/checkpoints.jsonl
    const file = path.join(
      projectDir,
      ".claude",
      "context-layer",
      "checkpoints.jsonl",
    );
    expect(fs.existsSync(file)).toBe(true);
    const written = JSON.parse(fs.readFileSync(file, "utf-8").trim());
    expect(written.session_id).toBe("s1");
  });

  it("skips short sessions below the tool-call threshold", async () => {
    const shortPath = path.join(projectDir, "short.jsonl");
    fs.writeFileSync(
      shortPath,
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: {} }] },
      }),
    );
    const checkpoint = await runReducer(
      { session_id: "s2", transcript_path: shortPath },
      {},
    );
    expect(checkpoint).toBeNull();
  });

  it("returns null on a missing transcript without throwing", async () => {
    const checkpoint = await runReducer(
      {
        session_id: "s3",
        transcript_path: path.join(projectDir, "nope.jsonl"),
      },
      {},
    );
    expect(checkpoint).toBeNull();
  });
});

describe("precompact-reducer (event-ledger mode)", () => {
  it("reduces ledger events into an events-sourced checkpoint", async () => {
    writeEvent(
      { sessionId: "L1", kind: "edit", files: ["src/x.ts"], outcome: "ok" },
      { projectDir },
    );
    writeEvent(
      { sessionId: "L1", kind: "write", files: ["src/y.ts"], outcome: "ok" },
      { projectDir },
    );
    writeEvent(
      { sessionId: "L1", kind: "test", summary: "vitest run", outcome: "ok" },
      { projectDir },
    );
    // An event from a different session must be excluded.
    writeEvent(
      { sessionId: "other", kind: "edit", files: ["src/z.ts"] },
      { projectDir },
    );

    const checkpoint: any = await runReducer(
      { session_id: "L1", transcript_path: transcriptPath },
      LEDGER_ON,
    );

    expect(checkpoint).not.toBeNull();
    expect(checkpoint.source).toBe("events");
    expect(checkpoint.changedFiles.sort()).toEqual(["src/x.ts", "src/y.ts"]);
    expect(checkpoint.changedFiles).not.toContain("src/z.ts");
    expect(checkpoint.testsRun).toContain("vitest run");
    expect(typeof checkpoint.checkpointIndex).toBe("number");

    // A "where was I" headline is synthesized and persisted with the checkpoint.
    expect(typeof checkpoint.focus).toBe("string");
    expect(checkpoint.focus).toContain("more"); // two changed files → "(+1 more)"
    expect(checkpoint.focus).toContain("last test: vitest run");
  });

  it("falls back to the transcript stub when the ledger has no events", async () => {
    const checkpoint: any = await runReducer(
      { session_id: "L2", transcript_path: transcriptPath },
      LEDGER_ON,
    );
    expect(checkpoint).not.toBeNull();
    expect(checkpoint.source).toBe("transcript");
  });

  it("runs retention GC even when the session has no new events", async () => {
    // An out-of-retention event (other session) + an expired memory. A
    // compaction with no NEW events for THIS session must still GC both —
    // previously prune sat inside the events-present branch and was skipped.
    writeEvent(
      {
        sessionId: "old",
        kind: "read",
        ts: "2000-01-01T00:00:00.000Z",
        files: ["stale"],
      },
      { projectDir },
    );
    appendMemory(projectDir, {
      projectId: "prj_test",
      kind: "gotcha",
      scope: "project",
      text: "expired note",
      severity: "low",
      confidence: "observed",
      provenance: { source: "event" },
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    expect(readMemories(projectDir)).toHaveLength(1);

    const checkpoint: any = await runReducer(
      { session_id: "L3", transcript_path: transcriptPath },
      LEDGER_ON,
    );

    expect(checkpoint.source).toBe("transcript"); // no events for L3
    expect(readEvents(projectDir)).toHaveLength(0); // old event pruned
    expect(readMemories(projectDir)).toHaveLength(0); // expired memory pruned
  });
});

describe("deriveFocus (deterministic 'where was I' headline)", () => {
  it("returns undefined when nothing is in flight", () => {
    expect(deriveFocus(null)).toBeUndefined();
    expect(deriveFocus({})).toBeUndefined();
    expect(deriveFocus({ workingFiles: [] })).toBeUndefined();
  });

  it("leads with a single file unqualified, multiple as (+N more)", () => {
    expect(deriveFocus({ changedFiles: ["a.ts"] })).toBe("a.ts");
    expect(deriveFocus({ changedFiles: ["a.ts", "b.ts", "c.ts"] })).toBe(
      "a.ts (+2 more)",
    );
  });

  it("prefers changedFiles over workingFiles", () => {
    expect(
      deriveFocus({ changedFiles: ["edited.ts"], workingFiles: ["read.ts"] }),
    ).toBe("edited.ts");
    // falls back to workingFiles when nothing changed
    expect(deriveFocus({ workingFiles: ["read.ts"] })).toBe("read.ts");
  });

  it("composes files · open loops · last test · next action", () => {
    const focus = deriveFocus({
      changedFiles: ["a.ts", "b.ts"],
      openLoops: ["wire handler", "add test"],
      testsRun: ["unit", "vitest run"],
      nextActions: ["ship it"],
    });
    expect(focus).toBe(
      "a.ts (+1 more) · 2 open loops · last test: vitest run · → next: ship it",
    );
  });

  it("surfaces recent errors only when there are no open loops", () => {
    expect(
      deriveFocus({ changedFiles: ["a.ts"], failures: ["boom", "bang"] }),
    ).toBe("a.ts · 2 recent errors");
    // open loops take precedence over the error count
    expect(
      deriveFocus({
        changedFiles: ["a.ts"],
        openLoops: ["loop"],
        failures: ["boom"],
      }),
    ).toBe("a.ts · 1 open loop");
  });
});
