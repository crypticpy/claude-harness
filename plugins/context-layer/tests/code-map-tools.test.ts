import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createTestStorage, type ContextStorage } from "../src/storage";
import { semanticLookup } from "../src/tools/semantic-lookup";
import { checkImpact } from "../src/tools/impact-check";
import { getSymbolContext } from "../src/tools/symbol-context";
import { refreshIndex } from "../src/tools/refresh-index";
import { indexStatusTool } from "../src/tools/index-status";

let projectDir: string;
let savedEnv: Record<string, string | undefined>;

function write(rel: string, content: string): void {
  const abs = path.join(projectDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  projectDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "puntax-cmtools-")),
  );
  savedEnv = {
    PUNTAX_CODE_MAP: process.env.PUNTAX_CODE_MAP,
    PUNTAX_CONFIG_PATH: process.env.PUNTAX_CONFIG_PATH,
  };
  // Force the code map on via env override; point config at a nonexistent path
  // so the loader falls back to defaults (+ env override) deterministically.
  process.env.PUNTAX_CODE_MAP = "true";
  process.env.PUNTAX_CONFIG_PATH = path.join(projectDir, "no-config.json");
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("semantic_lookup index fast path", () => {
  it("warms the code map and answers from the index without reading disk", async () => {
    write("a.ts", `export function alpha(): number { return 1; }\n`);
    // Pin mtime to a clean integer-ms instant BEFORE indexing so floor(mtimeMs)
    // is identical at index time and lookup time. Raw FS mtimeMs carries a
    // sub-ms float that can straddle an integer boundary and flip under
    // Math.floor between two stat() reads, which would falsely mark the file
    // stale (a safe re-read in production, but it defeats this assertion).
    const abs = path.join(projectDir, "a.ts");
    const pinned = new Date(1_700_000_000_000);
    fs.utimesSync(abs, pinned, pinned);
    const storage: ContextStorage = createTestStorage();

    // Call 1 — parses, populates file-index + code-map (stores mtime = pinned).
    const first = await semanticLookup(
      { filePath: "a.ts", projectPath: projectDir },
      { storage },
    );
    expect(first.exports).toContain("alpha");
    expect(
      fs.existsSync(
        path.join(projectDir, ".claude", "context-layer", "code-map.db"),
      ),
    ).toBe(true);

    // Overwrite content but restore the same pinned mtime, so the file looks
    // unchanged. The fast path keys off mtime, so it must return the STALE (v1)
    // summary — proving it did not re-read disk.
    write("a.ts", `export function beta(): number { return 2; }\n`);
    fs.utimesSync(abs, pinned, pinned);

    const second = await semanticLookup(
      { filePath: "a.ts", projectPath: projectDir },
      { storage },
    );
    expect(second.exports).toContain("alpha");
    expect(second.exports).not.toContain("beta");
    expect(second.needsFullRead).toBe(false);

    await storage.close();
  });
});

describe("impact_check index-first (file level)", () => {
  it("reports importers from code-map import edges", async () => {
    write("src/util.ts", `export function helper() { return 1; }\n`);
    write(
      "src/main.ts",
      `import { helper } from './util';\nexport function run() { return helper(); }\n`,
    );

    const res = await checkImpact({
      filePath: path.join(projectDir, "src/util.ts"),
      projectPath: projectDir,
    });

    expect(res.success).toBe(true);
    const deps = res.data!.dependents;
    expect(deps.length).toBeGreaterThanOrEqual(1);
    expect(deps.some((d) => d.filePath.endsWith("main.ts"))).toBe(true);
    expect(deps.every((d) => d.usage === "import")).toBe(true);
  });
});

describe("symbol_context index tier", () => {
  it("resolves a symbol from the index after a refresh", async () => {
    write(
      "src/base.ts",
      `export class Base {}\nexport class Widget extends Base {}\n`,
    );
    await refreshIndex({ projectPath: projectDir });

    const ctx = await getSymbolContext({
      symbolName: "Widget",
      projectPath: projectDir,
    });

    expect(ctx).not.toBeNull();
    expect(ctx!.kind).toBe("class");
    expect(ctx!.location.filePath.endsWith("base.ts")).toBe(true);
    expect(ctx!.related.some((r) => r.name === "Base")).toBe(true);
  });
});

describe("refresh_index + index_status", () => {
  it("runs a full index and reports coverage", async () => {
    write("src/a.ts", `export function a() {}\n`);
    write("src/b.ts", `export function b() {}\n`);

    const refreshed = await refreshIndex({ projectPath: projectDir });
    expect(refreshed.enabled).toBe(true);
    expect(refreshed.indexed).toBe(true);
    expect(refreshed.filesIndexed).toBe(2);
    expect(refreshed.symbols).toBeGreaterThanOrEqual(2);

    const status = await indexStatusTool({ projectPath: projectDir });
    expect(status.enabled).toBe(true);
    expect(status.indexed).toBe(true);
    expect(status.files).toBe(2);
    expect(status.lastRun?.mode).toBe("full");
  });

  it("incrementally refreshes only changed files", async () => {
    write("src/a.ts", `export function a() {}\n`);
    write("src/b.ts", `export function b() {}\n`);
    await refreshIndex({ projectPath: projectDir });

    write("src/a.ts", `export function a() {}\nexport function a2() {}\n`);
    const inc = await refreshIndex({
      projectPath: projectDir,
      changedFiles: ["src/a.ts"],
    });
    expect(inc.mode).toBe("incremental");
    expect(inc.filesIndexed).toBe(1);
  });

  it("returns disabled when PUNTAX_CODE_MAP is off", async () => {
    process.env.PUNTAX_CODE_MAP = "false";
    const res = await refreshIndex({ projectPath: projectDir });
    expect(res.enabled).toBe(false);
    expect(res.mode).toBe("disabled");
  });
});
