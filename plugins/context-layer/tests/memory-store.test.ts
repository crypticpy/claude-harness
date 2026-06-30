import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  memoryId,
  normalizeMemory,
  validateMemory,
  appendMemory,
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
} from "../../../hooks/unified/modules/memory-store.mjs";

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

  it("is a no-op (no rewrite) when nothing needs dropping", () => {
    appendMemory(dir, baseInput({ text: "only row" }));
    const res = pruneMemories(dir, { now: NOW });
    expect(res).toEqual({ kept: 1, dropped: 0 });
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
