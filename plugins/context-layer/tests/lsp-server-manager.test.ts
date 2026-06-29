import { describe, it, expect } from "vitest";
import {
  LspServerManager,
  serversFor,
  commandOnPath,
} from "../src/lsp/server-manager";
import type { ILspClient, Diagnostic } from "../src/lsp/client";

class FakeClient implements ILspClient {
  isRunning = false;
  starts = 0;
  stops = 0;
  constructor(
    readonly onDiag: (uri: string, d: Diagnostic[]) => void,
    private readonly failStart = false,
  ) {}
  async start(): Promise<void> {
    this.starts++;
    if (this.failStart) throw new Error("spawn failed");
    this.isRunning = true;
  }
  async stop(): Promise<void> {
    this.stops++;
    this.isRunning = false;
  }
  async request(): Promise<unknown> {
    return null;
  }
  notify(): void {}
  didOpen(): void {}
  syncDocument(): void {}
  didClose(): void {}
  emit(uri: string, d: Diagnostic[]): void {
    this.onDiag(uri, d);
  }
}

const ROOT = "/repo";
const diag: Diagnostic = {
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  severity: 1,
  message: "x",
};

describe("serversFor", () => {
  it("maps the TS family to typescript-language-server", () => {
    for (const lang of [
      "typescript",
      "typescriptreact",
      "javascript",
      "javascriptreact",
    ] as const) {
      expect(serversFor(lang)[0].command).toBe("typescript-language-server");
    }
  });
  it("offers pyright then pylsp for python, and single servers for go/rust", () => {
    expect(serversFor("python").map((s) => s.command)).toEqual([
      "pyright-langserver",
      "pylsp",
    ]);
    expect(serversFor("go")[0].command).toBe("gopls");
    expect(serversFor("rust")[0].command).toBe("rust-analyzer");
  });
  it("returns nothing for unknown languages", () => {
    expect(serversFor("unknown")).toEqual([]);
  });
});

describe("commandOnPath", () => {
  it("finds a real executable and rejects a bogus one", () => {
    expect(commandOnPath("node")).toBe(true);
    expect(commandOnPath("definitely-not-a-real-binary-xyz")).toBe(false);
  });
});

describe("LspServerManager", () => {
  it("returns null when no server is installed", async () => {
    const mgr = new LspServerManager({ isOnPath: () => false });
    expect(await mgr.getClient(ROOT, "typescript")).toBeNull();
  });

  it("starts and caches one client across the TS family", async () => {
    let made = 0;
    const mgr = new LspServerManager({
      isOnPath: (c) => c === "typescript-language-server",
      createClient: (_s, onDiag) => {
        made++;
        return new FakeClient(onDiag);
      },
    });
    const a = await mgr.getClient(ROOT, "typescript");
    const b = await mgr.getClient(ROOT, "typescriptreact");
    expect(a).not.toBeNull();
    expect(a).toBe(b); // shared server, single spawn
    expect(made).toBe(1);
  });

  it("does not retry a server that failed to start", async () => {
    let made = 0;
    const mgr = new LspServerManager({
      isOnPath: () => true,
      createClient: (_s, onDiag) => {
        made++;
        return new FakeClient(onDiag, /* failStart */ true);
      },
    });
    expect(await mgr.getClient(ROOT, "go")).toBeNull();
    expect(await mgr.getClient(ROOT, "go")).toBeNull();
    expect(made).toBe(1); // failure cached; no second spawn
  });

  it("records pushed diagnostics and resolves waiters", async () => {
    let fake!: FakeClient;
    const mgr = new LspServerManager({
      isOnPath: (c) => c === "gopls",
      createClient: (_s, onDiag) => (fake = new FakeClient(onDiag)),
    });
    await mgr.getClient(ROOT, "go");
    const uri = "file:///repo/a.go";

    const pending = mgr.waitForDiagnostics(ROOT, "go", uri, 1000);
    fake.emit(uri, [diag]);
    expect(await pending).toEqual([diag]);
    expect(mgr.diagnosticsFor(ROOT, "go", uri)).toEqual([diag]);
  });

  it("resolves waitForDiagnostics to [] on timeout", async () => {
    const mgr = new LspServerManager({
      isOnPath: (c) => c === "gopls",
      createClient: (_s, onDiag) => new FakeClient(onDiag),
    });
    await mgr.getClient(ROOT, "go");
    const out = await mgr.waitForDiagnostics(ROOT, "go", "file:///x.go", 15);
    expect(out).toEqual([]);
  });

  it("shuts down all clients", async () => {
    let fake!: FakeClient;
    const mgr = new LspServerManager({
      isOnPath: () => true,
      createClient: (_s, onDiag) => (fake = new FakeClient(onDiag)),
    });
    await mgr.getClient(ROOT, "rust");
    await mgr.shutdownAll();
    expect(fake.stops).toBe(1);
    expect(fake.isRunning).toBe(false);
  });
});
