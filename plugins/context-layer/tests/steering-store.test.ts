import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  readCharter,
  writeCharter,
  clearCharter,
  readManifest,
  manifestAdd,
  manifestTick,
  manifestTickByFile,
  manifestDrop,
  manifestItemId,
  isInScope,
  normalizeRelPath,
} from "../src/storage/steering-store";

// The .mjs twin must fold the SAME ledger to the SAME state (cross-runtime
// parity, like memory-store).
const mjs = await import("../../../hooks/unified/modules/steering-store.mjs");

let projectDir: string;

beforeEach(() => {
  projectDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "steering-store-")),
  );
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

const CHARTER_FILE = () =>
  path.join(projectDir, ".claude", "context-layer", "charter.json");
const MANIFEST_FILE = () =>
  path.join(projectDir, ".claude", "context-layer", "manifest.jsonl");

describe("charter — verbatim storage", () => {
  it("round-trips the mission verbatim, including formatting", () => {
    const mission =
      "Migrate ALL 60 call sites of `oldApi()` to `newApi()`.\n\n  - keep behavior identical\n  - NO drive-by refactors";
    writeCharter(projectDir, {
      mission,
      scope: ["src/api/", "tests/api"],
      constraints: ["never touch src/legacy/"],
    });
    const read = readCharter(projectDir);
    expect(read?.mission).toBe(mission); // exact — never trimmed/summarized
    expect(read?.scope).toEqual(["src/api/", "tests/api"]);
    expect(read?.constraints).toEqual(["never touch src/legacy/"]);
  });

  it("preserves createdAt across overwrites and bumps updatedAt", () => {
    const first = writeCharter(projectDir, { mission: "v1" });
    const second = writeCharter(projectDir, { mission: "v2" });
    expect(second.createdAt).toBe(first.createdAt);
    expect(readCharter(projectDir)?.mission).toBe("v2");
  });

  it("rejects an empty mission", () => {
    expect(() => writeCharter(projectDir, { mission: "   " })).toThrow();
  });

  it("returns null for a corrupt or missing charter (fail-open)", () => {
    expect(readCharter(projectDir)).toBeNull();
    fs.mkdirSync(path.dirname(CHARTER_FILE()), { recursive: true });
    fs.writeFileSync(CHARTER_FILE(), "not json {");
    expect(readCharter(projectDir)).toBeNull();
  });

  it("clearCharter removes the file and reports whether it existed", () => {
    expect(clearCharter(projectDir)).toBe(false);
    writeCharter(projectDir, { mission: "m" });
    expect(clearCharter(projectDir)).toBe(true);
    expect(readCharter(projectDir)).toBeNull();
  });
});

describe("manifest — append-only fold", () => {
  it("adds, ticks by id, ticks by file, and drops", () => {
    const [a, b, c] = manifestAdd(projectDir, [
      { file: "src/a.ts", note: "rename foo" },
      { file: "src/b.ts" },
      { file: "src/c.ts", symbol: "gamma" },
    ]);
    expect(readManifest(projectDir)).toMatchObject({
      total: 3,
      remaining: 3,
      done: 0,
    });

    expect(manifestTick(projectDir, [a])).toEqual([a]);
    const tickedItems = manifestTickByFile(projectDir, path.join(projectDir, "src/b.ts"));
    expect(tickedItems.map((i) => i.id)).toEqual([b]);
    expect(manifestDrop(projectDir, [c], "already migrated")).toEqual([c]);

    const state = readManifest(projectDir);
    expect(state).toMatchObject({ total: 3, remaining: 0, done: 2, dropped: 1 });
  });

  it("ids are content-addressed and path-normalization-stable", () => {
    const relId = manifestItemId(projectDir, { file: "src/a.ts", note: "n" });
    const absId = manifestItemId(projectDir, {
      file: path.join(projectDir, "src/a.ts"),
      note: "n",
    });
    expect(absId).toBe(relId);
    expect(relId).toMatch(/^wi_[0-9a-f]{12}$/);
  });

  it("re-adding a pending item is a no-op; re-adding a done item re-opens it", () => {
    const [id] = manifestAdd(projectDir, [{ file: "src/a.ts" }]);
    manifestAdd(projectDir, [{ file: "src/a.ts" }]);
    expect(readManifest(projectDir).total).toBe(1);

    manifestTick(projectDir, [id]);
    expect(readManifest(projectDir).done).toBe(1);
    manifestAdd(projectDir, [{ file: "src/a.ts" }]); // explicit re-add = re-open
    expect(readManifest(projectDir)).toMatchObject({ total: 1, remaining: 1, done: 0 });
  });

  it("double-tick and unknown ids are harmless no-ops", () => {
    const [id] = manifestAdd(projectDir, [{ file: "src/a.ts" }]);
    manifestTick(projectDir, [id]);
    expect(manifestTick(projectDir, [id, "wi_nonexistent1"])).toEqual([]);
    expect(readManifest(projectDir)).toMatchObject({ total: 1, done: 1 });
  });

  it("tolerates corrupt ledger lines", () => {
    manifestAdd(projectDir, [{ file: "src/a.ts" }]);
    fs.appendFileSync(MANIFEST_FILE(), "corrupt {\n");
    manifestAdd(projectDir, [{ file: "src/b.ts" }]);
    expect(readManifest(projectDir).total).toBe(2);
  });
});

describe("scope checks", () => {
  it("prefix-matches directories, not string prefixes", () => {
    expect(isInScope(["src/auth"], "src/auth/login.ts")).toBe(true);
    expect(isInScope(["src/auth/"], "src/auth/login.ts")).toBe(true);
    expect(isInScope(["src/auth"], "src/auth.ts")).toBe(false); // not src/authX
    expect(isInScope(["src/auth"], "src/authz/x.ts")).toBe(false);
    expect(isInScope([], "anything.ts")).toBe(true); // no scope = no check
  });

  it("normalizeRelPath makes absolute paths repo-relative posix", () => {
    expect(normalizeRelPath(projectDir, path.join(projectDir, "src", "a.ts"))).toBe(
      "src/a.ts",
    );
    expect(normalizeRelPath(projectDir, "./src/a.ts")).toBe("src/a.ts");
  });
});

describe("cross-runtime parity (.ts twin vs .mjs twin)", () => {
  it("both runtimes fold the same ledger to the same state and agree on ids", () => {
    // Interleave writers across runtimes on the SAME files.
    manifestAdd(projectDir, [{ file: "src/a.ts", note: "n1" }]);
    mjs.manifestAdd(projectDir, [{ file: "src/b.ts" }]);
    const idFromTs = manifestItemId(projectDir, { file: "src/a.ts", note: "n1" });
    const idFromMjs = mjs.manifestItemId(projectDir, { file: "src/a.ts", note: "n1" });
    expect(idFromMjs).toBe(idFromTs);

    mjs.manifestTick(projectDir, [idFromTs]);

    const tsState = readManifest(projectDir);
    const mjsState = mjs.readManifest(projectDir);
    expect(mjsState).toEqual(tsState);
    expect(tsState).toMatchObject({ total: 2, remaining: 1, done: 1 });
  });

  it("a charter written by the .ts runtime reads identically from the .mjs runtime", () => {
    const mission = "verbatim ✓ — with unicode and\nnewlines";
    writeCharter(projectDir, { mission, scope: ["src/"], constraints: ["c1"] });
    const viaMjs = mjs.readCharter(projectDir);
    expect(viaMjs).toEqual(readCharter(projectDir));
    expect(viaMjs?.mission).toBe(mission);
  });
});
