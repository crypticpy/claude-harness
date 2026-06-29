import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  resolveContextDir,
  resolveGlobalDir,
  resolveCacheDir,
  contextPaths,
  ensureDir,
} from "../src/storage/paths";

import {
  resolveContextDir as resolveContextDirMjs,
  contextPaths as contextPathsMjs,
} from "../../../hooks/unified/modules/storage-paths.mjs";

describe("storage-tier path resolution", () => {
  it("resolves the project-local context dir", () => {
    expect(resolveContextDir("/repo")).toBe(
      path.join("/repo", ".claude", "context-layer"),
    );
  });

  it("resolves the global and cache tiers from a home dir", () => {
    expect(resolveGlobalDir("/home/u")).toBe(
      path.join("/home/u", ".claude", "context-layer", "global"),
    );
    expect(resolveCacheDir("/home/u")).toBe(
      path.join("/home/u", ".claude", "cache", "context-layer"),
    );
  });

  it("derives named project-local files", () => {
    const p = contextPaths("/repo");
    const base = path.join("/repo", ".claude", "context-layer");
    expect(p.dir).toBe(base);
    expect(p.events).toBe(path.join(base, "events.jsonl"));
    expect(p.checkpoints).toBe(path.join(base, "checkpoints.jsonl"));
    expect(p.memories).toBe(path.join(base, "memories.jsonl"));
    expect(p.codeMapDb).toBe(path.join(base, "code-map.db"));
    expect(p.lessons).toBe(path.join(base, "lessons.jsonl"));
  });

  it("throws on an empty project dir (never silently writes to cwd root)", () => {
    expect(() => resolveContextDir("")).toThrow();
    // @ts-expect-error intentional bad input
    expect(() => resolveContextDir(undefined)).toThrow();
  });
});

describe("ensureDir", () => {
  it("creates a missing directory and is idempotent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-paths-"));
    const target = path.join(root, "a", "b", "c");
    ensureDir(target);
    expect(fs.existsSync(target)).toBe(true);
    expect(() => ensureDir(target)).not.toThrow();
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("cross-runtime parity (.ts vs .mjs)", () => {
  it("resolveContextDir matches", () => {
    expect(resolveContextDirMjs("/repo")).toBe(resolveContextDir("/repo"));
  });
  it("contextPaths match", () => {
    expect(contextPathsMjs("/repo")).toEqual(contextPaths("/repo"));
  });
});
