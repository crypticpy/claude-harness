import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { LspServerManager } from "../src/lsp/server-manager";
import { LspClient } from "../src/lsp/client";
import { LSPCache } from "../src/lsp/cache";
import * as ops from "../src/lsp/operations";

const FIXTURE = path.resolve("tests/fixtures/mock-lsp-server.mjs");

let dir: string;
let filePath: string;
let manager: LspServerManager;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lsp-ops-"));
  filePath = path.join(dir, "a.ts");
  fs.writeFileSync(filePath, "export class Foo {}\n");
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
});

afterEach(async () => {
  await manager.shutdownAll();
  fs.rmSync(dir, { recursive: true, force: true });
});

const opts = () => ({ projectRoot: dir, manager, cache: new LSPCache() });

describe("LSP operations against a mock server", () => {
  it("definition maps LSP 0-based ranges to 1-based SymbolLocation", async () => {
    const r = await ops.definition(filePath, { line: 1, character: 0 }, opts());
    expect(r.success).toBe(true);
    expect(r.data![0]).toMatchObject({ filePath, line: 3, character: 4 });
  });

  it("references map to Reference[]", async () => {
    const r = await ops.references(filePath, { line: 1, character: 0 }, opts());
    expect(r.data).toHaveLength(2);
    expect(r.data!.map((x) => x.line)).toEqual([3, 8]);
  });

  it("hover extracts the markup value", async () => {
    const r = await ops.hover(filePath, { line: 1, character: 0 }, opts());
    expect(r.data!.documentation).toBe("mock hover text");
  });

  it("documentSymbols flattens nested children with mapped kinds", async () => {
    const r = await ops.documentSymbols(filePath, opts());
    const byName = new Map(r.data!.map((s) => [s.name, s]));
    expect(byName.get("MockClass")!.kind).toBe("class");
    expect(byName.get("method")!.kind).toBe("method");
    expect(byName.get("method")!.containerName).toBe("MockClass");
  });

  it("diagnostics waits for the push after sync", async () => {
    const r = await ops.diagnostics(filePath, {
      ...opts(),
      diagnosticsTimeoutMs: 2000,
    });
    expect(r.success).toBe(true);
    expect(r.data![0].message).toBe("mock diagnostic");
  });

  it("returns success:false (no fallback) when no server is available", async () => {
    const none = new LspServerManager({ isOnPath: () => false });
    const r = await ops.definition(
      filePath,
      { line: 1, character: 0 },
      {
        projectRoot: dir,
        manager: none,
        cache: new LSPCache(),
      },
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no language server/);
  });

  it("serves an identical repeat query from cache", async () => {
    const cache = new LSPCache();
    const o = { projectRoot: dir, manager, cache };
    const first = await ops.definition(filePath, { line: 1, character: 0 }, o);
    const second = await ops.definition(filePath, { line: 1, character: 0 }, o);
    expect(first.metadata?.cached).toBe(false);
    expect(second.metadata?.cached).toBe(true);
  });
});
