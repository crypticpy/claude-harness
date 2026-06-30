import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  readCheckpoints,
  collectStructuredContext,
  renderStructuredFacts,
} from "../../../hooks/unified/modules/structured-context.mjs";
import {
  appendMemory,
  projectIdFor,
} from "../../../hooks/unified/modules/memory-store.mjs";

let dir: string;
let ctxDir: string;
let checkpointsFile: string;

function writeCheckpoints(lines: unknown[]) {
  fs.writeFileSync(
    checkpointsFile,
    lines
      .map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
      .join("\n") + "\n",
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "structured-"));
  ctxDir = path.join(dir, ".claude", "context-layer");
  fs.mkdirSync(ctxDir, { recursive: true });
  checkpointsFile = path.join(ctxDir, "checkpoints.jsonl");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("readCheckpoints", () => {
  it("returns only well-formed checkpoint lines, oldest→newest", () => {
    writeCheckpoints([
      { type: "checkpoint", session_id: "s1", checkpointIndex: 0, risk: "low" },
      "not json at all",
      { type: "other", session_id: "s1" }, // wrong type, ignored
      {
        type: "checkpoint",
        session_id: "s2",
        checkpointIndex: 1,
        risk: "high",
      },
    ]);
    const all = readCheckpoints(dir);
    expect(all).toHaveLength(2);
    expect(all[0].session_id).toBe("s1");
    expect(all[1].risk).toBe("high");
  });

  it("filters by sessionId and returns [] when the file is absent", () => {
    writeCheckpoints([
      { type: "checkpoint", session_id: "s1", risk: "low" },
      { type: "checkpoint", session_id: "s2", risk: "high" },
    ]);
    expect(readCheckpoints(dir, { sessionId: "s2" } as any)).toHaveLength(1);
    expect(readCheckpoints(path.join(dir, "nope"))).toEqual([]);
  });
});

describe("collectStructuredContext", () => {
  it("reports available:false when no substrate exists", () => {
    const s = collectStructuredContext(dir);
    expect(s.available).toBe(false);
    expect(s.counts).toEqual({ checkpoints: 0, memories: 0 });
  });

  it("rolls up checkpoints + typed memory deterministically", () => {
    writeCheckpoints([
      {
        type: "checkpoint",
        session_id: "s1",
        source: "events",
        changedFiles: ["a.ts", "b.ts"],
        failures: ["compile error in a.ts"],
        openLoops: ["Unresolved error in b.ts: boom"],
        decisions: ["use forks pool"],
        testsRun: ["vitest run"],
        risk: "medium",
      },
      {
        type: "checkpoint",
        session_id: "s1",
        source: "events",
        changedFiles: ["b.ts", "c.ts"],
        failures: [],
        openLoops: [],
        decisions: [],
        testsRun: ["vitest run tests/x"],
        risk: "high",
      },
    ]);
    appendMemory(dir, {
      projectId: projectIdFor(dir),
      kind: "failure_pattern",
      scope: "project",
      text: "tests flake on mtime granularity",
      severity: "high",
      confidence: "observed",
      provenance: { source: "test_failure" },
    });
    appendMemory(dir, {
      projectId: projectIdFor(dir),
      kind: "gotcha",
      scope: "file",
      text: "preserve CRLF on write",
      severity: "medium",
      confidence: "user_confirmed",
      provenance: { source: "user" },
    });

    const s = collectStructuredContext(dir);
    expect(s.available).toBe(true);
    expect(s.counts).toEqual({ checkpoints: 2, memories: 2 });
    // latest checkpoint risk leads
    expect(s.latestRisk).toBe("high");
    // changed files deduped across checkpoints
    expect(s.changedFiles.sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(s.openLoops).toContain("Unresolved error in b.ts: boom");
    expect(s.failures).toContain("compile error in a.ts");
    expect(s.memoryByKind).toEqual({ failure_pattern: 1, gotcha: 1 });
    // top memories sorted by severity (high before medium)
    expect(s.topMemories[0].severity).toBe("high");
  });

  it("excludes expired and malformed-expiry memories from the SessionStart roll-up", () => {
    // The injected context must match the store's "active, non-expired" contract:
    // an expired row and a present-but-unparseable expiresAt (Date.parse -> NaN)
    // are both hidden, so only the live memory counts.
    const base = {
      projectId: projectIdFor(dir),
      kind: "gotcha",
      scope: "project",
      severity: "high",
      confidence: "observed",
      provenance: { source: "test_failure" },
    };
    appendMemory(dir, {
      ...base,
      text: "live memory survives the roll-up",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    appendMemory(dir, {
      ...base,
      text: "expired memory must be dropped",
      expiresAt: "2020-01-01T00:00:00Z",
    });
    appendMemory(dir, {
      ...base,
      text: "corrupt-expiry memory must be dropped",
      expiresAt: "not-a-date",
    });

    const s = collectStructuredContext(dir);
    expect(s.counts.memories).toBe(1);
    expect(s.topMemories.map((m) => m.text)).toEqual([
      "live memory survives the roll-up",
    ]);
  });

  it("absorbs transcript-fallback checkpoints (recentErrors → failures)", () => {
    writeCheckpoints([
      {
        type: "checkpoint",
        session_id: "s1",
        source: "transcript",
        workingFiles: ["x.ts"],
        recentErrors: ["TypeError: undefined is not a function"],
      },
    ]);
    const s = collectStructuredContext(dir);
    expect(s.available).toBe(true);
    expect(s.failures).toContain("TypeError: undefined is not a function");
  });

  it("returns available:false for a null projectDir", () => {
    expect(collectStructuredContext(null).available).toBe(false);
  });
});

describe("renderStructuredFacts", () => {
  it("returns empty string when nothing is available", () => {
    expect(renderStructuredFacts(collectStructuredContext(dir))).toBe("");
    expect(renderStructuredFacts(null)).toBe("");
  });

  it("renders an authoritative block citing memory text", () => {
    writeCheckpoints([
      {
        type: "checkpoint",
        session_id: "s1",
        risk: "high",
        openLoops: ["fix the build"],
      },
    ]);
    appendMemory(dir, {
      projectId: projectIdFor(dir),
      kind: "gotcha",
      scope: "project",
      text: "run vitest from the plugin dir",
      severity: "high",
      confidence: "observed",
      provenance: { source: "event" },
    });
    const block = renderStructuredFacts(collectStructuredContext(dir));
    expect(block).toContain("AUTHORITATIVE");
    expect(block).toContain("run vitest from the plugin dir");
    expect(block).toContain("fix the build");
    expect(block).toContain("Latest session risk: high");
  });
});
