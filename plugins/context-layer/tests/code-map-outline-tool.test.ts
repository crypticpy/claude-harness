import { describe, it, expect, beforeAll, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { codeMapOutlineTool } from "../src/tools/code-map-outline";
import { warmTreeSitter } from "../src/indexer/backends/tree-sitter";

// Warm so the lazy index uses the extracted (tree-sitter) tier, not regex.
beforeAll(async () => {
  await warmTreeSitter();
});

describe("code_map_outline — directory structural map", () => {
  let dir: string;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lists top-level symbols and resolved in-project imports, no methods", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-outline-"));
    fs.writeFileSync(
      path.join(dir, "base.ts"),
      "export class Base {\n  helper() { return 1; }\n}\n",
    );
    fs.writeFileSync(
      path.join(dir, "child.ts"),
      [
        "import { Base } from './base';",
        "export class Child extends Base {",
        "  run() {}",
        "}",
        "export function build() { return 0; }",
      ].join("\n") + "\n",
    );

    const r = await codeMapOutlineTool({ projectPath: dir });
    expect(r.indexed).toBe(true);
    expect(r.fileCount).toBe(2);

    const child = r.files.find((f) => f.path === "child.ts")!;
    expect(child).toBeTruthy();
    expect(child.language).toBe("typescript");
    const childNames = child.symbols.map((s) => s.name);
    expect(childNames).toContain("Child");
    // A second top-level definition is captured (functions are symbols).
    expect(childNames).toContain("build");
    // `run` is a method (parented) — outline is top-level only.
    expect(childNames).not.toContain("run");
    // Top-level symbols carry their kind + line.
    const cls = child.symbols.find((s) => s.name === "Child")!;
    expect(cls.kind).toBe("class");
    expect(cls.line).toBe(2);
    // Import edge resolved to the in-project target path.
    expect(child.imports).toEqual(["base.ts"]);

    const base = r.files.find((f) => f.path === "base.ts")!;
    expect(base.symbols.map((s) => s.name)).toContain("Base");
    expect(base.symbols.map((s) => s.name)).not.toContain("helper");
    expect(base.imports).toEqual([]);
  });

  it("scopes the outline to a subdirectory via `dir`", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-outline-dir-"));
    fs.mkdirSync(path.join(dir, "pkg"));
    fs.writeFileSync(path.join(dir, "root.ts"), "export const r = 1;\n");
    fs.writeFileSync(path.join(dir, "pkg", "inner.ts"), "export const i = 2;\n");

    const r = await codeMapOutlineTool({ projectPath: dir, dir: "pkg" });
    expect(r.indexed).toBe(true);
    expect(r.dir).toBe("pkg");
    expect(r.files.map((f) => f.path)).toEqual(["pkg/inner.ts"]);
  });
});
