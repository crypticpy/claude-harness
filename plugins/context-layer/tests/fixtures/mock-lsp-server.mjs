#!/usr/bin/env node
/**
 * Minimal deterministic LSP server for tests. Speaks Content-Length framed
 * JSON-RPC over stdio and answers just enough for the client/operations tests:
 * initialize, definition, references, hover, documentSymbol, and a
 * publishDiagnostics push on didOpen. It deliberately does NOT answer
 * `textDocument/unknownMethod` so the client's request-timeout path can be
 * exercised. Real language servers cannot run deterministically in CI; this
 * stands in for one.
 */

function send(msg) {
  const buf = Buffer.from(JSON.stringify(msg), "utf8");
  process.stdout.write(`Content-Length: ${buf.length}\r\n\r\n`);
  process.stdout.write(buf);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const header = buffer.toString("utf8", 0, headerEnd);
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if (!m) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const len = parseInt(m[1], 10);
    const start = headerEnd + 4;
    if (buffer.length < start + len) break;
    const body = buffer.toString("utf8", start, start + len);
    buffer = buffer.subarray(start + len);
    try {
      handle(JSON.parse(body));
    } catch {
      // ignore malformed
    }
  }
});

function handle(msg) {
  const { id, method, params } = msg;

  if (method === "initialize") {
    respond(id, {
      capabilities: {
        textDocumentSync: 1,
        definitionProvider: true,
        referencesProvider: true,
        hoverProvider: true,
        documentSymbolProvider: true,
      },
      serverInfo: { name: "mock-lsp", version: "0.0.0" },
    });
    // Exercise the client's server->client request handling.
    send({ jsonrpc: "2.0", id: 9001, method: "workspace/configuration", params: { items: [{}] } });
    return;
  }

  if (method === "initialized") return;

  if (method === "textDocument/didOpen") {
    const uri = params?.textDocument?.uri;
    send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri,
        diagnostics: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 5 },
            },
            severity: 1,
            message: "mock diagnostic",
            source: "mock",
          },
        ],
      },
    });
    return;
  }

  if (method === "textDocument/didChange" || method === "textDocument/didClose") {
    return;
  }

  if (method === "textDocument/definition") {
    const uri = params?.textDocument?.uri;
    respond(id, {
      uri,
      range: {
        start: { line: 2, character: 4 },
        end: { line: 2, character: 9 },
      },
    });
    return;
  }

  if (method === "textDocument/references") {
    const uri = params?.textDocument?.uri;
    respond(id, [
      {
        uri,
        range: {
          start: { line: 2, character: 4 },
          end: { line: 2, character: 9 },
        },
      },
      {
        uri,
        range: {
          start: { line: 7, character: 1 },
          end: { line: 7, character: 6 },
        },
      },
    ]);
    return;
  }

  if (method === "textDocument/hover") {
    respond(id, {
      contents: { kind: "markdown", value: "mock hover text" },
    });
    return;
  }

  if (method === "textDocument/documentSymbol") {
    respond(id, [
      {
        name: "MockClass",
        kind: 5, // Class
        range: { start: { line: 0, character: 0 }, end: { line: 9, character: 0 } },
        selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 15 } },
        children: [
          {
            name: "method",
            kind: 6, // Method
            range: { start: { line: 1, character: 2 }, end: { line: 3, character: 3 } },
            selectionRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } },
          },
        ],
      },
    ]);
    return;
  }

  if (method === "shutdown") {
    // Emit an observable sentinel BEFORE replying so a test can confirm the
    // client actually sent shutdown (the graceful path) rather than only
    // force-killing us. Ordering is preserved on the pipe, so the client
    // processes this notification before the shutdown reply resolves.
    send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///__shutdown__",
        diagnostics: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            severity: 1,
            message: "shutdown-received",
            source: "mock",
          },
        ],
      },
    });
    respond(id, null);
    return;
  }

  if (method === "exit") {
    process.exit(0);
  }

  // Any other request id (e.g. textDocument/unknownMethod) is intentionally
  // left unanswered to drive the client's request-timeout path.
}
