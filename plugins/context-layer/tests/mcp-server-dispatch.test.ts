import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
// handleRequest is the exact entry the live stdio server dispatches through, so
// this exercises the real tool wiring — not a tool function in isolation. Safe to
// import: main() is guarded by `require.main === module` and does not run here.
import { handleRequest } from "../src/mcp-server";

type Req = Parameters<typeof handleRequest>[0];

function call(name: string, args: Record<string, unknown>): Req {
  return { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
}

function textOf(res: Awaited<ReturnType<typeof handleRequest>>): string {
  const result = res.result as
    | { content?: Array<{ type: string; text: string }> }
    | undefined;
  return result?.content?.[0]?.text ?? "";
}

let projectDir: string;

beforeEach(() => {
  projectDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "puntax-dispatch-")),
  );
  const abs = path.join(projectDir, "mod.ts");
  fs.writeFileSync(
    abs,
    [
      "import { join } from 'path';",
      "export function alpha() { return 1; }",
      "export function beta() { return 2; }",
      "export const gamma = join('a', 'b');",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("mcp-server dispatch — semantic_lookup outlineOnly (live wiring)", () => {
  it("outlineOnly returns the compact outline, not the full structured object", async () => {
    const res = await handleRequest(
      call("semantic_lookup", {
        paths: ["mod.ts"],
        projectDir,
        outlineOnly: true,
      }),
    );
    const text = textOf(res);

    // Compact outline shape from formatLookupResult(_, true).
    expect(text).toContain("mod.ts");
    expect(text).toContain("lines");
    expect(text).toContain("Exports (3)"); // alpha, beta, gamma
    // The token-heavy bits are dropped.
    expect(text).not.toContain("Dependencies");
    // It is plain text, NOT a JSON dump of the result object.
    expect(text.trimStart().startsWith("{")).toBe(false);
  });

  it("without outlineOnly the same tool returns the full structured result", async () => {
    const res = await handleRequest(
      call("semantic_lookup", { paths: ["mod.ts"], projectDir }),
    );
    const text = textOf(res);

    // Full mode serializes the structured object (JSON) carrying the summary.
    const parsed = JSON.parse(text);
    expect(parsed.exports).toContain("alpha");
    expect(typeof parsed.summary).toBe("string");
    expect(parsed.lineCount).toBeGreaterThan(0);
  });
});

describe("mcp-server dispatch — symbol_context (live wiring)", () => {
  // symbol_context had no dispatch coverage. These guard the case wiring end to
  // end: the filePath arg reaching searchInFile, resolution, and serialization.
  let symFile: string;
  beforeEach(() => {
    symFile = path.join(projectDir, "sym.ts");
    fs.writeFileSync(
      symFile,
      [
        "export interface Widget { id: number; }",
        "export function makeWidget(input: Widget) { return input; }",
        "",
      ].join("\n"),
    );
  });

  it("resolves a symbol end-to-end through handleRequest", async () => {
    const res = await handleRequest(
      call("symbol_context", {
        symbolName: "makeWidget",
        filePath: symFile,
        projectDir,
      }),
    );
    const parsed = JSON.parse(textOf(res));
    expect(parsed.name).toBe("makeWidget");
    expect(parsed.kind).toBe("function");
    expect(typeof parsed.signature).toBe("string");
    expect(parsed.location.line).toBe(2); // makeWidget is on the 2nd line
  });

  it("accepts signatureOnly and returns a well-formed compact result", async () => {
    // The flag is honored after resolution; the compact contract is that the
    // token-heavy fields are never populated and the signature is preserved.
    const res = await handleRequest(
      call("symbol_context", {
        symbolName: "makeWidget",
        filePath: symFile,
        projectDir,
        signatureOnly: true,
      }),
    );
    const parsed = JSON.parse(textOf(res));
    expect(parsed.name).toBe("makeWidget");
    expect(typeof parsed.signature).toBe("string");
    expect(parsed.related).toEqual([]);
    expect(parsed.documentation).toBe("");
  });
});
