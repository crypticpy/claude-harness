import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  memoryId,
  normalizeMemory,
  validateMemory,
  appendMemory,
  appendMemories,
  readMemories,
  memoriesPath,
  pruneMemories,
  type MemoryInput,
} from "../src/storage/memory-store";
import { memoryWrite } from "../src/tools/memory-write";
import { projectIdFor as projectIdForTs } from "../src/storage/code-map";

// Cross-runtime parity: the hook `.mjs` store must compute identical ids so both
// runtimes share one memories.jsonl.
import {
  memoryId as memoryIdMjs,
  validateMemory as validateMemoryMjs,
  projectIdFor as projectIdForMjs,
  pruneMemories as pruneMemoriesMjs,
  appendMemories as appendMemoriesMjs,
} from "../../../hooks/unified/modules/memory-store.mjs";
import { classifyBashCommand } from "../../../hooks/unified/modules/event-writer.mjs";

let dir: string;

const baseInput = (over: Partial<MemoryInput> = {}): MemoryInput => ({
  projectId: "prj_test",
  kind: "gotcha",
  scope: "project",
  text: "CRLF files break the formatter; preserve newlines on write",
  severity: "high",
  confidence: "observed",
  provenance: { source: "event" },
  ...over,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-store-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("memoryId — content addressing", () => {
  it("is deterministic for identical content", () => {
    expect(memoryId("prj_a", "gotcha", "project", "x")).toBe(
      memoryId("prj_a", "gotcha", "project", "x"),
    );
  });

  it("differs when any component differs", () => {
    const base = memoryId("prj_a", "gotcha", "project", "x");
    expect(memoryId("prj_a", "gotcha", "project", "y")).not.toBe(base);
    expect(memoryId("prj_a", "decision", "project", "x")).not.toBe(base);
    expect(memoryId("prj_b", "gotcha", "project", "x")).not.toBe(base);
  });

  it("matches the mem_ id pattern", () => {
    expect(memoryId("prj_a", "gotcha", "project", "x")).toMatch(
      /^mem_[A-Za-z0-9_-]+$/,
    );
  });
});

describe("normalizeMemory — defaults", () => {
  it("fills id, empty arrays, active status, and createdAt", () => {
    const m = normalizeMemory(baseInput());
    expect(m.id).toMatch(/^mem_/);
    expect(m.files).toEqual([]);
    expect(m.symbols).toEqual([]);
    expect(m.status).toBe("active");
    expect(typeof m.createdAt).toBe("string");
  });
});

describe("validateMemory", () => {
  it("accepts a well-formed memory", () => {
    expect(validateMemory(normalizeMemory(baseInput())).valid).toBe(true);
  });

  it("rejects bad enums, empty text, and bad id", () => {
    expect(
      validateMemory({ ...normalizeMemory(baseInput()), kind: "nope" }).valid,
    ).toBe(false);
    expect(
      validateMemory({ ...normalizeMemory(baseInput()), text: "" }).valid,
    ).toBe(false);
    expect(
      validateMemory({ ...normalizeMemory(baseInput()), id: "x" }).valid,
    ).toBe(false);
    expect(validateMemory(null).valid).toBe(false);
  });

  it("rejects a missing provenance source", () => {
    const m = normalizeMemory(baseInput()) as unknown as Record<
      string,
      unknown
    >;
    m.provenance = {};
    expect(validateMemory(m).valid).toBe(false);
  });
});

describe("appendMemory — persist + dedup + reject", () => {
  it("writes a valid memory and reads it back", () => {
    const res = appendMemory(dir, baseInput());
    expect(res.written).toBe(true);
    const all = readMemories(dir);
    expect(all).toHaveLength(1);
    expect(all[0].text).toBe(baseInput().text);
    expect(fs.existsSync(memoriesPath(dir))).toBe(true);
  });

  it("dedupes exact-duplicate content", () => {
    appendMemory(dir, baseInput());
    const second = appendMemory(dir, baseInput());
    expect(second.written).toBe(false);
    expect(second.reason).toBe("duplicate");
    expect(readMemories(dir)).toHaveLength(1);
  });

  it("rejects invalid input without writing", () => {
    const res = appendMemory(dir, baseInput({ text: "" }));
    expect(res.written).toBe(false);
    expect(res.reason).toBe("invalid");
    expect(readMemories(dir)).toHaveLength(0);
  });

  it("skips corrupt lines on read", () => {
    appendMemory(dir, baseInput());
    fs.appendFileSync(memoriesPath(dir), "{not json\n\n");
    expect(readMemories(dir)).toHaveLength(1);
  });
});

describe("appendMemories — batch persist (one read, one write)", () => {
  it("writes several distinct memories and reports each", () => {
    const res = appendMemories(dir, [
      baseInput({ text: "first fact" }),
      baseInput({ text: "second fact" }),
      baseInput({ text: "third fact" }),
    ]);
    expect(res.written).toBe(3);
    expect(res.results.map((r) => r.written)).toEqual([true, true, true]);
    expect(readMemories(dir)).toHaveLength(3);
  });

  it("dedups within the batch (two identical inputs collapse to one)", () => {
    const res = appendMemories(dir, [
      baseInput({ text: "same" }),
      baseInput({ text: "same" }),
    ]);
    expect(res.written).toBe(1);
    expect(res.results[1].reason).toBe("duplicate");
    expect(readMemories(dir)).toHaveLength(1);
  });

  it("dedups against rows already in the store", () => {
    appendMemory(dir, baseInput({ text: "already here" }));
    const res = appendMemories(dir, [
      baseInput({ text: "already here" }),
      baseInput({ text: "brand new" }),
    ]);
    expect(res.written).toBe(1);
    expect(res.results[0].reason).toBe("duplicate");
    expect(readMemories(dir)).toHaveLength(2);
  });

  it("reports invalid rows without aborting valid ones", () => {
    const res = appendMemories(dir, [
      baseInput({ text: "" }), // invalid
      baseInput({ text: "valid one" }),
    ]);
    expect(res.written).toBe(1);
    expect(res.results[0].reason).toBe("invalid");
    expect(res.results[1].written).toBe(true);
    expect(readMemories(dir)).toHaveLength(1);
  });

  it("matches the result of looping appendMemory (semantic equivalence)", () => {
    const inputs = [
      baseInput({ text: "a" }),
      baseInput({ text: "a" }), // dup
      baseInput({ text: "b" }),
      baseInput({ text: "" }), // invalid
    ];
    const batchDir = dir;
    const loopDir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-loop-"));
    try {
      const batch = appendMemories(batchDir, inputs);
      const loop = inputs.map((i) => appendMemory(loopDir, i));
      expect(batch.results.map((r) => [r.written, r.reason ?? null])).toEqual(
        loop.map((r) => [r.written, r.reason ?? null]),
      );
      expect(readMemories(batchDir).map((m) => m.text).sort()).toEqual(
        readMemories(loopDir).map((m) => m.text).sort(),
      );
    } finally {
      fs.rmSync(loopDir, { recursive: true, force: true });
    }
  });

  it("handles empty / non-array input without writing", () => {
    expect(appendMemories(dir, [])).toEqual({ written: 0, results: [] });
    expect(appendMemories(dir, null as never)).toEqual({ written: 0, results: [] });
    expect(fs.existsSync(memoriesPath(dir))).toBe(false);
  });
});

describe("cross-runtime parity (.ts vs .mjs)", () => {
  it("memoryId matches across runtimes", () => {
    expect(memoryIdMjs("prj_a", "gotcha", "project", "shared text")).toBe(
      memoryId("prj_a", "gotcha", "project", "shared text"),
    );
  });

  it("a TS-normalized memory validates under the .mjs validator", () => {
    const m = normalizeMemory(baseInput());
    expect(validateMemoryMjs(m).valid).toBe(true);
  });

  it("projectIdFor is path-resolution-invariant in both runtimes", () => {
    // A raw sha1 would differ for these equivalent paths; resolve() collapses
    // them, so a relative and an absolute caller key the same project.
    const canonical = projectIdForMjs("/proj/app");
    expect(projectIdForMjs("/proj/sub/../app")).toBe(canonical);
    expect(projectIdForTs("/proj/sub/../app")).toBe(canonical);
  });

  it("projectIdFor matches across runtimes for the same root", () => {
    expect(projectIdForTs("/x/y/z")).toBe(projectIdForMjs("/x/y/z"));
  });

  it("appendMemories writes rows the other runtime reads with identical ids", () => {
    // .mjs writes the batch; TS readMemories must parse every row back.
    const written = appendMemoriesMjs(dir, [
      baseInput({ text: "cross-runtime one" }),
      baseInput({ text: "cross-runtime two" }),
    ]);
    expect(written.written).toBe(2);
    const back = readMemories(dir);
    expect(back).toHaveLength(2);
    expect(back.map((m) => m.id).sort()).toEqual(
      written.results.map((r: { id: string }) => r.id).sort(),
    );
  });
});

describe("pruneMemories — retention GC", () => {
  const NOW = Date.parse("2026-06-30T00:00:00Z");
  const past = "2026-06-01T00:00:00Z";
  const future = "2026-12-01T00:00:00Z";

  it("drops expired and non-active rows, keeps active non-expired", () => {
    appendMemory(dir, baseInput({ text: "keep active" }));
    appendMemory(dir, baseInput({ text: "future expiry", expiresAt: future }));
    appendMemory(dir, baseInput({ text: "past expiry", expiresAt: past }));
    appendMemory(dir, baseInput({ text: "superseded", status: "superseded" }));
    expect(readMemories(dir)).toHaveLength(4);

    const res = pruneMemories(dir, { now: NOW });
    expect(res.dropped).toBe(2);
    const texts = readMemories(dir)
      .map((m) => m.text)
      .sort();
    expect(texts).toEqual(["future expiry", "keep active"]);
  });

  it("drops a row whose expiry is present but unparseable (fail-safe)", () => {
    // A corrupt/garbage expiresAt makes Date.parse return NaN; NaN <= now is
    // false, so the naive check would keep it forever. Treat it as expired.
    appendMemory(dir, baseInput({ text: "keep active" }));
    appendMemory(dir, baseInput({ text: "garbage expiry", expiresAt: "not-a-date" }));
    expect(readMemories(dir)).toHaveLength(2);

    const res = pruneMemories(dir, { now: NOW });
    expect(res.byReason.expired).toBe(1);
    expect(readMemories(dir).map((m) => m.text)).toEqual(["keep active"]);
  });

  it("is a no-op (no rewrite) when nothing needs dropping", () => {
    appendMemory(dir, baseInput({ text: "only row" }));
    const res = pruneMemories(dir, { now: NOW });
    expect(res.kept).toBe(1);
    expect(res.dropped).toBe(0);
    expect(res.byReason).toEqual({
      corrupt: 0,
      invalid: 0,
      nonActive: 0,
      expired: 0,
      junk: 0,
      duplicate: 0,
      overCap: 0,
    });
  });

  it("breaks dropped rows down by reason", () => {
    appendMemory(dir, baseInput({ text: "keep active" }));
    appendMemory(dir, baseInput({ text: "past expiry", expiresAt: past }));
    appendMemory(dir, baseInput({ text: "superseded", status: "superseded" }));
    fs.appendFileSync(memoriesPath(dir), "{not json\n");
    const res = pruneMemories(dir, { now: NOW });
    expect(res.byReason.expired).toBe(1);
    expect(res.byReason.nonActive).toBe(1);
    expect(res.byReason.corrupt).toBe(1);
    expect(res.byReason.overCap).toBe(0);
    expect(res.dropped).toBe(3);
  });

  it("collapses duplicate-id rows from a cross-process append race", () => {
    // appendMemory dedups within one process, but the .mjs hook runtime and the
    // MCP server can both land the same content-addressed id. Simulate that by
    // re-appending the exact persisted line, then assert prune keeps one copy.
    appendMemory(dir, baseInput({ text: "raced row" }));
    const line = fs.readFileSync(memoriesPath(dir), "utf-8").trim();
    fs.appendFileSync(memoriesPath(dir), line + "\n");
    const res = pruneMemories(dir, { now: NOW });
    expect(res.byReason.duplicate).toBe(1);
    expect(res.kept).toBe(1);
    expect(res.dropped).toBe(1);
    expect(readMemories(dir).map((m) => m.text)).toEqual(["raced row"]);
  });

  it("caps per (kind, scope), preferring user-confirmed + higher severity", () => {
    // 3 low/observed + 1 high/user_confirmed, cap = 2 → keep the important one
    // plus the newest low one.
    appendMemory(
      dir,
      baseInput({ text: "low a", severity: "low", confidence: "observed" }),
    );
    appendMemory(
      dir,
      baseInput({ text: "low b", severity: "low", confidence: "observed" }),
    );
    appendMemory(
      dir,
      baseInput({
        text: "important",
        severity: "high",
        confidence: "user_confirmed",
      }),
    );
    const res = pruneMemories(dir, { now: NOW, kindCap: 2 });
    expect(res.kept).toBe(2);
    const texts = readMemories(dir).map((m) => m.text);
    expect(texts).toContain("important"); // protected by importance
  });

  it("drops rows flagged by an injected dropJunk predicate, counted as junk", () => {
    appendMemory(dir, baseInput({ text: "keep me" }));
    appendMemory(dir, baseInput({ text: "junk me" }));
    const res = pruneMemories(dir, {
      now: NOW,
      dropJunk: (m) => m.text === "junk me",
    });
    expect(res.byReason.junk).toBe(1);
    expect(res.dropped).toBe(1);
    expect(readMemories(dir).map((m) => m.text)).toEqual(["keep me"]);
  });

  it("a throwing dropJunk predicate never drops a row (fail-safe)", () => {
    appendMemory(dir, baseInput({ text: "survivor" }));
    const res = pruneMemories(dir, {
      now: NOW,
      dropJunk: () => {
        throw new Error("boom");
      },
    });
    expect(res.byReason.junk).toBe(0);
    expect(res.kept).toBe(1);
  });

  it("classifier predicate removes legacy mis-tagged test_command rows, keeps real ones", () => {
    // The exact production predicate: a test_command whose text no longer reads
    // as a test under the current classifier was never a real test command.
    const isJunk = (m: { kind: string; text: string }) =>
      m.kind === "test_command" && classifyBashCommand(m.text) !== "test";
    appendMemory(
      dir,
      baseInput({ kind: "test_command", text: "npx vitest run" }),
    );
    appendMemory(
      dir,
      baseInput({ kind: "test_command", text: "cd plugins && npm test" }),
    );
    appendMemory(
      dir,
      baseInput({ kind: "test_command", text: "cd /repo && command git status" }),
    );
    const res = pruneMemories(dir, { now: NOW, dropJunk: isJunk });
    expect(res.byReason.junk).toBe(1); // only the git-status compound
    const kept = readMemories(dir).map((m) => m.text).sort();
    expect(kept).toEqual(["cd plugins && npm test", "npx vitest run"]);
  });

  it("matches the .mjs runtime row-for-row on the same store", () => {
    // Fixed createdAt so the two seedings are byte-identical — any difference
    // after prune would then be a genuine cross-runtime divergence.
    const at = "2026-06-15T00:00:00.000Z";
    const seed = () => {
      appendMemory(dir, baseInput({ text: "keep active", createdAt: at }));
      appendMemory(dir, baseInput({ text: "past expiry", expiresAt: past, createdAt: at }));
      appendMemory(dir, baseInput({ text: "superseded", status: "superseded", createdAt: at }));
    };
    // TS prune
    seed();
    pruneMemories(dir, { now: NOW });
    const tsRows = fs.readFileSync(memoriesPath(dir), "utf-8");
    // Reset + mjs prune over an identical seed
    fs.rmSync(memoriesPath(dir));
    seed();
    pruneMemoriesMjs(dir, { now: NOW });
    const mjsRows = fs.readFileSync(memoriesPath(dir), "utf-8");
    expect(mjsRows).toBe(tsRows);
  });
});

describe("memoryWrite tool — derives projectId + defaults", () => {
  it("writes via the tool and defaults severity/confidence/source", () => {
    const res = memoryWrite({
      kind: "test_command",
      scope: "project",
      text: "Run: npx vitest run from the plugin dir",
      projectPath: dir,
    });
    expect(res.written).toBe(true);
    const all = readMemories(dir);
    expect(all[0].confidence).toBe("user_confirmed");
    expect(all[0].severity).toBe("medium");
    expect(all[0].provenance.source).toBe("user");
    expect(all[0].projectId).toMatch(/^prj_/);
  });
});
