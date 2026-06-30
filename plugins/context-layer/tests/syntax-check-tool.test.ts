import { describe, it, expect, beforeAll, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { syntaxCheckTool } from "../src/tools/syntax-check";
import { warmTreeSitter } from "../src/indexer/backends/tree-sitter";

// Warm grammars once so the tool runs against the real AST (same path as live).
beforeAll(async () => {
  await warmTreeSitter();
});

describe("syntax_check — valid sources parse clean", () => {
  it("accepts well-formed TypeScript", async () => {
    const r = await syntaxCheckTool({
      filePath: "mod.ts",
      content: "export function foo(a: number): number { return a + 1; }\n",
    });
    expect(r.available).toBe(true);
    expect(r.supported).toBe(true);
    expect(r.language).toBe("typescript");
    expect(r.ok).toBe(true);
    expect(r.errorCount).toBe(0);
    expect(r.errors).toEqual([]);
  });

  it("accepts well-formed Python", async () => {
    const r = await syntaxCheckTool({
      filePath: "mod.py",
      content: "def foo(a):\n    return a + 1\n",
    });
    expect(r.ok).toBe(true);
    expect(r.errorCount).toBe(0);
  });
});

describe("syntax_check — broken sources are flagged with location", () => {
  it("reports an ERROR node for malformed TypeScript", async () => {
    const r = await syntaxCheckTool({
      filePath: "mod.ts",
      // missing close paren + brace
      content: "function foo( {\n  return 1;\n",
    });
    expect(r.ok).toBe(false);
    expect(r.errorCount).toBeGreaterThan(0);
    const first = r.errors[0];
    expect(["error", "missing"]).toContain(first.kind);
    expect(first.line).toBeGreaterThanOrEqual(1);
    expect(typeof first.column).toBe("number");
  });

  it("reports a defect for malformed Python", async () => {
    const r = await syntaxCheckTool({
      filePath: "mod.py",
      content: "def foo(:\n    return 1\n",
    });
    expect(r.ok).toBe(false);
    expect(r.errorCount).toBeGreaterThan(0);
  });
});

describe("syntax_check — unsupported + read paths", () => {
  it("treats a language with no grammar as a no-op (supported:false, ok:true)", async () => {
    const r = await syntaxCheckTool({
      filePath: "main.rb",
      content: "def broken(\n",
    });
    expect(r.available).toBe(true);
    expect(r.supported).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.errorCount).toBe(0);
  });

  it("surfaces a read error (no content, missing file) without throwing", async () => {
    const r = await syntaxCheckTool({
      filePath: "/nope/does-not-exist-xyz.ts",
    });
    expect(r.available).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.readError).toBeTruthy();
  });
});

describe("syntax_check — reads file content from disk", () => {
  let dir: string;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("checks a real on-disk file when content is omitted", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-check-"));
    const good = path.join(dir, "good.ts");
    const bad = path.join(dir, "bad.ts");
    fs.writeFileSync(good, "export const x = 1;\n");
    fs.writeFileSync(bad, "export const x = ;\n");

    const okRes = await syntaxCheckTool({ filePath: good });
    expect(okRes.ok).toBe(true);

    const badRes = await syntaxCheckTool({ filePath: bad });
    expect(badRes.ok).toBe(false);
    expect(badRes.errorCount).toBeGreaterThan(0);
  });

  it("resolves a relative filePath against projectPath", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-check-rel-"));
    fs.writeFileSync(path.join(dir, "rel.ts"), "export const y = 2;\n");
    const r = await syntaxCheckTool({ filePath: "rel.ts", projectPath: dir });
    expect(r.ok).toBe(true);
    expect(r.supported).toBe(true);
  });
});
