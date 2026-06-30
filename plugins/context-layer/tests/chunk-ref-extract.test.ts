import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  extractChunk,
  parseChunkId,
  computeContentHash,
} from "../src/tools/chunk-ref";

describe("parseChunkId — splits on the LAST colon (path-safe)", () => {
  it("splits a normal filePath:symbol id", () => {
    expect(parseChunkId("src/foo.ts:bar")).toEqual({
      filePath: "src/foo.ts",
      symbolName: "bar",
    });
  });

  it("keeps a drive/colon-bearing path intact by splitting on the last colon", () => {
    // A Windows-style path has its own colon; only the final one separates the symbol.
    expect(parseChunkId("C:/win/foo.ts:bar")).toEqual({
      filePath: "C:/win/foo.ts",
      symbolName: "bar",
    });
  });

  it("rejects an id with no colon", () => {
    expect(parseChunkId("nocolon")).toBeNull();
  });

  it("rejects an id whose only colon is leading (no filePath)", () => {
    expect(parseChunkId(":leading")).toBeNull();
  });
});

describe("computeContentHash — stable 16-hex staleness key", () => {
  it("is deterministic and 16 hex chars", () => {
    const h = computeContentHash("hello world");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(computeContentHash("hello world")).toBe(h);
  });

  it("differs for different content", () => {
    expect(computeContentHash("a")).not.toBe(computeContentHash("b"));
  });
});

describe("extractChunk — single-symbol extraction (brace + indent block ends)", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "chunk-extract-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("extracts a TS function with its full brace-delimited body (and nothing after)", async () => {
    const file = path.join(dir, "mod.ts");
    fs.writeFileSync(
      file,
      [
        "export function alpha() {",
        "  if (true) {",
        "    return 1;",
        "  }",
        "}",
        "",
        "export function beta() { return 2; }",
        "",
      ].join("\n"),
    );
    const chunk = await extractChunk(file, "alpha");
    expect(chunk).not.toBeNull();
    // Nested braces are balanced, so the block ends at alpha's closing brace,
    // not beta's.
    expect(chunk).toContain("function alpha");
    expect(chunk).toContain("return 1;");
    expect(chunk!.trimEnd().endsWith("}")).toBe(true);
    expect(chunk).not.toContain("beta");
  });

  it("extracts a Python def by indentation, stopping before the next def", async () => {
    const file = path.join(dir, "mod.py");
    fs.writeFileSync(
      file,
      [
        "def foo():",
        "    x = 1",
        "    return x",
        "",
        "def bar():",
        "    return 2",
        "",
      ].join("\n"),
    );
    const chunk = await extractChunk(file, "foo");
    expect(chunk).not.toBeNull();
    expect(chunk).toContain("def foo");
    expect(chunk).toContain("return x");
    expect(chunk).not.toContain("def bar");
  });

  it("returns null for an unreadable file", async () => {
    const chunk = await extractChunk(path.join(dir, "missing.ts"), "alpha");
    expect(chunk).toBeNull();
  });

  it("returns null when the symbol is absent everywhere (parse + fallback)", async () => {
    const file = path.join(dir, "mod.ts");
    fs.writeFileSync(file, "export function alpha() { return 1; }\n");
    const chunk = await extractChunk(file, "doesNotExist");
    expect(chunk).toBeNull();
  });
});
