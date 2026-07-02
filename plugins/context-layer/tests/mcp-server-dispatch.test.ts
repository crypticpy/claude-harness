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

  it("batch mode resolves RELATIVE paths against projectDir and returns real summaries", async () => {
    // Regression: the batch branch used to return the raw BatchLookupResult,
    // whose Maps JSON.stringify to {} — every batch call came back as
    // {"results":{},"errors":{}} regardless of success.
    fs.writeFileSync(
      path.join(projectDir, "other.ts"),
      "export const delta = 4;\n",
    );
    const res = await handleRequest(
      call("semantic_lookup", { paths: ["mod.ts", "other.ts"], projectDir }),
    );
    const parsed = JSON.parse(textOf(res));
    expect(parsed.results["mod.ts"]).toBeTruthy();
    expect(typeof parsed.results["mod.ts"].summary).toBe("string");
    expect(parsed.results["mod.ts"].exports).toContain("alpha");
    expect(parsed.results["other.ts"].exports).toContain("delta");
    expect(parsed.errors).toEqual({});
  });

  it("batch mode reports an explicit per-path error for an unresolvable path", async () => {
    const res = await handleRequest(
      call("semantic_lookup", {
        paths: ["mod.ts", "does-not-exist.ts"],
        projectDir,
      }),
    );
    const parsed = JSON.parse(textOf(res));
    // The good path still resolves; the bad one carries a string message —
    // never a silent empty object.
    expect(parsed.results["mod.ts"].exports).toContain("alpha");
    expect(typeof parsed.errors["does-not-exist.ts"]).toBe("string");
    expect(parsed.errors["does-not-exist.ts"].length).toBeGreaterThan(0);
    expect(parsed.errors["does-not-exist.ts"]).toContain("not found");
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
    // Post-LSP-removal contract: a structural tier answered, never complete.
    expect(["index", "parse"]).toContain(parsed.provenance.strategy);
    expect(parsed.provenance.complete).toBe(false);
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
    // Bug-3 regression: the signature is the literal declaration (parameters
    // included), never the bare symbol name.
    expect(parsed.signature).toContain("input: Widget");
    expect(parsed.related).toEqual([]);
    expect(parsed.documentation).toBe("");
    expect(["index", "parse"]).toContain(parsed.provenance.strategy);
    expect(parsed.provenance.complete).toBe(false);
  });
});

describe("mcp-server dispatch — syntax_check (live wiring)", () => {
  // Guards the schema-entry + handleRequest-case wiring for the new tool (the
  // "dead at the live boundary" gotcha: green unit tests, missing case).
  it("flags broken content with a located error through handleRequest", async () => {
    const res = await handleRequest(
      call("syntax_check", { filePath: "broken.ts", content: "function f( {\n" }),
    );
    const parsed = JSON.parse(textOf(res));
    expect(parsed.available).toBe(true);
    expect(parsed.supported).toBe(true);
    expect(parsed.ok).toBe(false);
    expect(parsed.errorCount).toBeGreaterThan(0);
    expect(parsed.errors[0].line).toBeGreaterThanOrEqual(1);
  });

  it("passes clean content (ok:true) through handleRequest", async () => {
    const res = await handleRequest(
      call("syntax_check", { filePath: "ok.ts", content: "export const x = 1;\n" }),
    );
    const parsed = JSON.parse(textOf(res));
    expect(parsed.ok).toBe(true);
    expect(parsed.errorCount).toBe(0);
  });
});

describe("mcp-server dispatch — code_map_outline (live wiring)", () => {
  it("maps top-level symbols + imports through handleRequest", async () => {
    const res = await handleRequest(call("code_map_outline", { projectDir }));
    const parsed = JSON.parse(textOf(res));
    expect(parsed.indexed).toBe(true);
    const mod = parsed.files.find(
      (f: { path: string }) => f.path === "mod.ts",
    );
    expect(mod).toBeTruthy();
    const names = mod.symbols.map((s: { name: string }) => s.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    // mod.ts imports from 'path' — an external module, so no in-project edge.
    expect(Array.isArray(mod.imports)).toBe(true);
  });
});

describe("mcp-server dispatch — steering tools (live wiring)", () => {
  it("mission_charter set/get round-trips the mission verbatim", async () => {
    const mission = "Migrate every call site.\n- no drive-bys";
    const setRes = await handleRequest(
      call("mission_charter", {
        action: "set",
        mission,
        scope: ["src/"],
        constraints: ["keep the public API frozen"],
        projectPath: projectDir,
      }),
    );
    const set = JSON.parse(textOf(setRes));
    expect(set.charter.mission).toBe(mission);

    const getRes = await handleRequest(
      call("mission_charter", { action: "get", projectPath: projectDir }),
    );
    const got = JSON.parse(textOf(getRes));
    expect(got.charter.mission).toBe(mission);
    expect(got.charter.scope).toEqual(["src/"]);
  });

  it("refactor_manifest add → status → tick folds through handleRequest", async () => {
    const addRes = await handleRequest(
      call("refactor_manifest", {
        action: "add",
        items: [{ file: "mod.ts", note: "split exports" }, { file: "src/x.ts" }],
        projectPath: projectDir,
      }),
    );
    const added = JSON.parse(textOf(addRes));
    expect(added.addedIds).toHaveLength(2);
    expect(added.state.remaining).toBe(2);

    const tickRes = await handleRequest(
      call("refactor_manifest", {
        action: "tick",
        ids: [added.addedIds[0]],
        projectPath: projectDir,
      }),
    );
    const ticked = JSON.parse(textOf(tickRes));
    expect(ticked.state).toMatchObject({ total: 2, remaining: 1, done: 1 });
  });
});
