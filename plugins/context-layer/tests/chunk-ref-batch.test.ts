import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractChunksBatch } from "../src/tools/chunk-ref";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "chunk-batch-"));
  file = path.join(dir, "mod.ts");
  fs.writeFileSync(
    file,
    [
      "export function alpha() {",
      "  return 1;",
      "}",
      "",
      "export class Beta {",
      "  greet() { return 'hi'; }",
      "}",
      "",
      "export const gamma = 42;",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("extractChunksBatch — one read+parse for many symbols", () => {
  it("returns a chunk per requested symbol, order-preserving", async () => {
    const out = await extractChunksBatch(file, ["gamma", "alpha", "Beta"]);
    expect(out.map((c) => c.symbolName)).toEqual(["gamma", "alpha", "Beta"]);
    expect(out.every((c) => c.found)).toBe(true);
    const alpha = out.find((c) => c.symbolName === "alpha")!;
    expect(alpha.content).toContain("function alpha");
    const beta = out.find((c) => c.symbolName === "Beta")!;
    expect(beta.content).toContain("class Beta");
  });

  it("marks missing symbols not-found without failing the batch", async () => {
    const out = await extractChunksBatch(file, ["alpha", "nope"]);
    expect(out.find((c) => c.symbolName === "alpha")!.found).toBe(true);
    const missing = out.find((c) => c.symbolName === "nope")!;
    expect(missing.found).toBe(false);
    expect(missing.content).toBeNull();
  });

  it("returns all-null for an unreadable file", async () => {
    const out = await extractChunksBatch(
      path.join(dir, "does-not-exist.ts"),
      ["alpha"],
    );
    expect(out).toEqual([{ symbolName: "alpha", content: null, found: false }]);
  });
});
