import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  LspServerManager,
  setGlobalServerManager,
  resetGlobalServerManager,
} from "../src/lsp/server-manager";
import { LspClient } from "../src/lsp/client";
import { resetGlobalCache } from "../src/lsp/cache";
import { getSymbolContext } from "../src/tools/symbol-context";
import { checkImpact } from "../src/tools/impact-check";

// Drive the real tool seams (symbol_context / impact_check) through the LSP
// tier by seeding the process-global server manager with a mock-backed client
// and flipping PUNTAX_LSP on. This proves the wiring — tier ordering + result
// mapping — not just the operations layer (covered by lsp-operations.test.ts).

const FIXTURE = path.resolve("tests/fixtures/mock-lsp-server.mjs");

let dir: string;
let filePath: string;
let manager: LspServerManager;
const prevLsp = process.env.PUNTAX_LSP;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lsp-wiring-"));
  filePath = path.join(dir, "a.ts");
  fs.writeFileSync(filePath, "export class MockClass {}\n");

  resetGlobalCache();
  manager = new LspServerManager({
    isOnPath: () => true,
    createClient: (spec, onDiag) =>
      new LspClient({
        command: "node",
        args: [FIXTURE],
        rootPath: spec.projectRoot,
        onDiagnostics: onDiag,
        requestTimeoutMs: 2000,
        initializeTimeoutMs: 4000,
      }),
  });
  setGlobalServerManager(manager);
  process.env.PUNTAX_LSP = "true";
});

afterEach(async () => {
  if (prevLsp === undefined) delete process.env.PUNTAX_LSP;
  else process.env.PUNTAX_LSP = prevLsp;
  // Stop the spawned mock LSP child before dropping the manager reference.
  await manager.shutdownAll();
  resetGlobalServerManager();
  resetGlobalCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("symbol_context — LSP tier", () => {
  it("answers from LSP documentSymbol + hover + definition", async () => {
    const result = await getSymbolContext({
      symbolName: "MockClass",
      filePath,
      projectPath: dir,
    });
    expect(result).not.toBeNull();
    expect(result!.name).toBe("MockClass");
    expect(result!.kind).toBe("class");
    // hover supplies the signature/documentation text
    expect(result!.signature).toBe("mock hover text");
    expect(result!.documentation).toBe("mock hover text");
    // definition (range start line 2, 0-based) resolves to 1-based line 3
    expect(result!.location.line).toBe(3);
    // LSP is the only type-resolved tier -> complete.
    expect(result!.provenance).toEqual({ strategy: "lsp", complete: true });
  });
});

describe("impact_check — LSP tier", () => {
  it("uses LSP references for dependents and attaches diagnostics", async () => {
    const result = await checkImpact({
      filePath,
      symbolName: "MockClass",
      projectPath: dir,
    });
    expect(result.success).toBe(true);
    const data = result.data!;
    expect(data.symbol).toBe("MockClass");
    // mock references: lines 2 and 7 (0-based) -> 3 and 8 (1-based)
    expect(data.dependents.map((d) => d.line).sort()).toEqual([3, 8]);
    expect(data.dependents.every((d) => d.symbolUsed === "MockClass")).toBe(
      true,
    );
    // diagnostics are attached only on the LSP path
    expect(data.diagnostics?.[0]?.message).toBe("mock diagnostic");
    // Reference-level tier: real usage sites -> complete.
    expect(data.provenance).toEqual({ strategy: "lsp", complete: true });
  });
});
