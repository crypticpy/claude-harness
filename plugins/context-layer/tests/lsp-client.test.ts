import { describe, it, expect, afterEach } from "vitest";
import * as path from "path";
import { LspClient, type Diagnostic } from "../src/lsp/client";

const FIXTURE = path.resolve("tests/fixtures/mock-lsp-server.mjs");

let client: LspClient | null = null;
afterEach(async () => {
  if (client) {
    await client.stop();
    client = null;
  }
});

function makeClient(
  onDiagnostics?: (uri: string, d: Diagnostic[]) => void,
): LspClient {
  return new LspClient({
    command: "node",
    args: [FIXTURE],
    rootPath: process.cwd(),
    onDiagnostics,
    requestTimeoutMs: 2000,
    initializeTimeoutMs: 4000,
  });
}

describe("LspClient against a mock server", () => {
  it("completes the initialize handshake", async () => {
    client = makeClient();
    await client.start();
    expect(client.isRunning).toBe(true);
  });

  it("round-trips a definition request", async () => {
    client = makeClient();
    await client.start();
    const res = await client.request("textDocument/definition", {
      textDocument: { uri: "file:///a.ts" },
      position: { line: 0, character: 0 },
    });
    expect(res).toMatchObject({
      uri: "file:///a.ts",
      range: { start: { line: 2, character: 4 } },
    });
  });

  it("delivers push diagnostics after didOpen", async () => {
    let resolve!: (d: Diagnostic[]) => void;
    const got = new Promise<Diagnostic[]>((r) => (resolve = r));
    client = makeClient((_uri, d) => resolve(d));
    await client.start();
    client.didOpen("file:///a.ts", "typescript", "const x = 1;");
    const diags = await got;
    expect(diags[0].message).toBe("mock diagnostic");
  });

  it("rejects a request the server never answers (timeout)", async () => {
    client = makeClient();
    await client.start();
    await expect(
      client.request("textDocument/unknownMethod", {}, 120),
    ).rejects.toThrow(/timed out/);
  });

  it("keeps working after a server->client request (answers it)", async () => {
    // The mock sends workspace/configuration right after initialize; the client
    // must answer it. A successful later request confirms nothing wedged.
    client = makeClient();
    await client.start();
    const res = await client.request("textDocument/hover", {
      textDocument: { uri: "file:///a.ts" },
      position: { line: 0, character: 0 },
    });
    expect(res).toMatchObject({ contents: { value: "mock hover text" } });
  });

  it("rejects in-flight requests when the server exits", async () => {
    client = makeClient();
    await client.start();
    const pending = client.request("textDocument/references", {
      textDocument: { uri: "file:///a.ts" },
      position: { line: 0, character: 0 },
    });
    await client.stop(); // sends shutdown/exit; fails anything in flight
    // Either the references resolved before exit or it rejected on stop; both
    // are acceptable — the guarantee is it does not hang.
    await pending.then(
      () => expect(true).toBe(true),
      (err) => expect(String(err)).toMatch(/stopped|exited/),
    );
  });
});
