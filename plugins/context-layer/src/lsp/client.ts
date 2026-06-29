/**
 * LSP client — a JSON-RPC conversation with one language server over stdio.
 *
 * Spawns the server, performs the initialize/initialized handshake, matches
 * responses to requests by id, dispatches `publishDiagnostics` notifications,
 * and answers the handful of server->client requests (configuration, capability
 * registration, progress) with benign defaults so servers don't stall.
 *
 * Every request has a timeout; a crashed/closed server rejects all in-flight
 * requests rather than hanging. Designed to fail loudly to its caller, which
 * then degrades to the scan-based tools.
 */

import { spawn, type ChildProcess } from "child_process";
import { pathToFileURL } from "url";
import { encodeMessage, MessageBuffer, type JsonRpcMessage } from "./protocol";

export interface Diagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity?: number; // 1 error, 2 warning, 3 info, 4 hint
  code?: string | number;
  source?: string;
  message: string;
}

export interface LspClientOptions {
  command: string;
  args: string[];
  /** Absolute project root used as the workspace folder. */
  rootPath: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  initializeTimeoutMs?: number;
  onDiagnostics?: (uri: string, diagnostics: Diagnostic[]) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_REQUEST_TIMEOUT = 8000;
const DEFAULT_INITIALIZE_TIMEOUT = 15000;

/**
 * The surface the server manager and operations depend on. Defined as an
 * interface so tests can substitute a fake without a real child process.
 */
export interface ILspClient {
  readonly isRunning: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  request(
    method: string,
    params: unknown,
    timeoutMs?: number,
  ): Promise<unknown>;
  notify(method: string, params: unknown): void;
  didOpen(uri: string, languageId: string, text: string): void;
  syncDocument(uri: string, languageId: string, text: string): void;
  didClose(uri: string): void;
}

export class LspClient implements ILspClient {
  private proc: ChildProcess | null = null;
  private readonly buffer = new MessageBuffer();
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private started = false;
  private stopped = false;
  private readonly openDocs = new Set<string>();
  private readonly docVersions = new Map<string, number>();

  constructor(private readonly opts: LspClientOptions) {}

  get isRunning(): boolean {
    return this.started && !this.stopped && this.proc !== null;
  }

  /** Spawn the server and complete the initialize handshake. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.proc = spawn(this.opts.command, this.opts.args, {
      cwd: this.opts.cwd ?? this.opts.rootPath,
      env: this.opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.on("exit", () => this.failAll("language server exited"));
    this.proc.on("error", (err) =>
      this.failAll(`language server error: ${err.message}`),
    );
    // Drain stderr so a chatty server can't fill the pipe and block.
    this.proc.stderr?.on("data", () => {});

    await this.initialize();
  }

  private async initialize(): Promise<void> {
    const rootUri = pathToFileURL(this.opts.rootPath).toString();
    const result = this.request(
      "initialize",
      {
        processId: process.pid,
        rootUri,
        rootPath: this.opts.rootPath,
        workspaceFolders: [{ uri: rootUri, name: "workspace" }],
        capabilities: {
          textDocument: {
            definition: { dynamicRegistration: false },
            references: { dynamicRegistration: false },
            hover: {
              dynamicRegistration: false,
              contentFormat: ["plaintext", "markdown"],
            },
            documentSymbol: {
              dynamicRegistration: false,
              hierarchicalDocumentSymbolSupport: true,
            },
            publishDiagnostics: { relatedInformation: false },
            synchronization: {
              dynamicRegistration: false,
              didSave: false,
            },
          },
          workspace: { configuration: true, workspaceFolders: true },
        },
      },
      this.opts.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT,
    );
    await result;
    this.notify("initialized", {});
  }

  // ---------------------------------------------------------------------------
  // text document lifecycle
  // ---------------------------------------------------------------------------

  /** Notify the server a document is open (required before queries). */
  didOpen(uri: string, languageId: string, text: string): void {
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
    this.openDocs.add(uri);
    this.docVersions.set(uri, 1);
  }

  /**
   * Make the server's view of a document match `text`: didOpen the first time,
   * full-document didChange thereafter (version-bumped). Callers query against
   * current file contents without tracking open state themselves.
   */
  syncDocument(uri: string, languageId: string, text: string): void {
    if (!this.openDocs.has(uri)) {
      this.didOpen(uri, languageId, text);
      return;
    }
    const version = (this.docVersions.get(uri) ?? 1) + 1;
    this.docVersions.set(uri, version);
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  didClose(uri: string): void {
    if (!this.openDocs.has(uri)) return;
    this.notify("textDocument/didClose", { textDocument: { uri } });
    this.openDocs.delete(uri);
    this.docVersions.delete(uri);
  }

  // ---------------------------------------------------------------------------
  // transport
  // ---------------------------------------------------------------------------

  request(
    method: string,
    params: unknown,
    timeoutMs = this.opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT,
  ): Promise<unknown> {
    if (!this.proc || this.stopped) {
      return Promise.reject(new Error("language server not running"));
    }
    const id = this.nextId++;
    const payload = encodeMessage({ jsonrpc: "2.0", id, method, params });

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request '${method}' timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write(payload);
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.proc || this.stopped) return;
    this.write(encodeMessage({ jsonrpc: "2.0", method, params }));
  }

  private write(payload: Buffer): void {
    try {
      this.proc?.stdin?.write(payload);
    } catch {
      // stdin closed; pending requests will time out / be failed on exit.
    }
  }

  private onData(chunk: Buffer): void {
    for (const msg of this.buffer.append(chunk)) this.handle(msg);
  }

  private handle(msg: JsonRpcMessage): void {
    // Response to one of our requests.
    if (
      msg.id !== undefined &&
      msg.method === undefined &&
      (msg.result !== undefined || msg.error !== undefined)
    ) {
      const pending = this.pending.get(msg.id as number);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(msg.id as number);
      if (msg.error) {
        pending.reject(new Error(msg.error.message || "LSP error"));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Server -> client request: answer with a benign default so it doesn't block.
    if (msg.method !== undefined && msg.id !== undefined) {
      this.answerServerRequest(msg);
      return;
    }

    // Notification.
    if (msg.method === "textDocument/publishDiagnostics") {
      const params = msg.params as {
        uri: string;
        diagnostics: Diagnostic[];
      };
      this.opts.onDiagnostics?.(params.uri, params.diagnostics ?? []);
    }
  }

  private answerServerRequest(msg: JsonRpcMessage): void {
    let result: unknown = null;
    if (msg.method === "workspace/configuration") {
      const items = (msg.params as { items?: unknown[] })?.items ?? [];
      result = items.map(() => ({}));
    }
    // client/registerCapability, window/workDoneProgress/create, etc. -> null.
    this.write(encodeMessage({ jsonrpc: "2.0", id: msg.id, result }));
  }

  private failAll(reason: string): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  /** Best-effort graceful shutdown, then force-kill. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try {
      await this.request("shutdown", null, 2000);
      this.notify("exit", null);
    } catch {
      // ignore — we kill below regardless
    } finally {
      this.failAll("language server stopped");
      try {
        this.proc?.kill();
      } catch {
        /* already gone */
      }
      this.proc = null;
    }
  }
}
