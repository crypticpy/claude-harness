/**
 * LSP server manager.
 *
 * Maps a language to the stdio language servers that can handle it, detects
 * which ones are actually installed (PATH scan), and lazily spawns + caches one
 * LspClient per (projectRoot, server command). Servers that aren't installed —
 * or fail to start — yield `null` so callers degrade to the code-map / regex
 * tiers instead of erroring.
 *
 * Detection and client construction are injectable so the manager is testable
 * without real language servers (which can't run deterministically here).
 */

import * as fs from "fs";
import * as path from "path";
import { LspClient, type ILspClient, type Diagnostic } from "./client";
import { getLanguageFromPath, type LanguageId } from "./types";

interface ServerSpec {
  command: string;
  args: string[];
}

/** Candidate stdio servers per language, in preference order. */
export function serversFor(language: LanguageId): ServerSpec[] {
  switch (language) {
    case "typescript":
    case "typescriptreact":
    case "javascript":
    case "javascriptreact":
      return [{ command: "typescript-language-server", args: ["--stdio"] }];
    case "python":
      return [
        { command: "pyright-langserver", args: ["--stdio"] },
        { command: "pylsp", args: [] },
      ];
    case "go":
      return [{ command: "gopls", args: [] }];
    case "rust":
      return [{ command: "rust-analyzer", args: [] }];
    default:
      return [];
  }
}

/** True if `command` resolves to an executable on PATH. */
export function commandOnPath(command: string): boolean {
  const PATH = process.env.PATH ?? "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  for (const dir of PATH.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        fs.accessSync(path.join(dir, command + ext), fs.constants.X_OK);
        return true;
      } catch {
        // keep scanning
      }
    }
  }
  return false;
}

export interface ResolvedSpec {
  command: string;
  args: string[];
  projectRoot: string;
}

export interface ServerManagerOptions {
  /** Override PATH detection (tests inject a fake). */
  isOnPath?: (command: string) => boolean;
  /** Override client construction (tests inject a mock server). */
  createClient?: (
    spec: ResolvedSpec,
    onDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void,
  ) => ILspClient;
}

export class LspServerManager {
  private readonly clients = new Map<string, ILspClient>();
  private readonly diagnostics = new Map<string, Map<string, Diagnostic[]>>();
  private readonly waiters = new Map<string, Array<() => void>>();
  private readonly failed = new Set<string>();
  private readonly isOnPath: (command: string) => boolean;
  private readonly createClient: (
    spec: ResolvedSpec,
    onDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void,
  ) => ILspClient;

  constructor(opts: ServerManagerOptions = {}) {
    this.isOnPath = opts.isOnPath ?? commandOnPath;
    this.createClient = opts.createClient ?? defaultCreateClient;
  }

  /** Resolve a started client for a file's language, or null if unavailable. */
  getClientForFile(
    projectRoot: string,
    filePath: string,
  ): Promise<ILspClient | null> {
    return this.getClient(projectRoot, getLanguageFromPath(filePath));
  }

  async getClient(
    projectRoot: string,
    language: LanguageId,
  ): Promise<ILspClient | null> {
    const spec = serversFor(language).find((s) => this.isOnPath(s.command));
    if (!spec) return null;

    const key = clientKey(projectRoot, spec.command);
    const existing = this.clients.get(key);
    if (existing && existing.isRunning) return existing;
    if (this.failed.has(key)) return null;

    const diagByUri = new Map<string, Diagnostic[]>();
    this.diagnostics.set(key, diagByUri);

    const client = this.createClient(
      { command: spec.command, args: spec.args, projectRoot },
      (uri, diags) => this.recordDiagnostics(key, uri, diags),
    );
    try {
      await client.start();
    } catch {
      this.failed.add(key);
      this.diagnostics.delete(key);
      return null;
    }
    this.clients.set(key, client);
    return client;
  }

  /** Latest diagnostics already received for a document (may be empty). */
  diagnosticsFor(
    projectRoot: string,
    language: LanguageId,
    uri: string,
  ): Diagnostic[] {
    const key = this.keyFor(projectRoot, language);
    if (!key) return [];
    return this.diagnostics.get(key)?.get(uri) ?? [];
  }

  /** Resolve once diagnostics for `uri` arrive, or after `timeoutMs`. */
  waitForDiagnostics(
    projectRoot: string,
    language: LanguageId,
    uri: string,
    timeoutMs: number,
  ): Promise<Diagnostic[]> {
    const key = this.keyFor(projectRoot, language);
    if (!key) return Promise.resolve([]);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve(this.diagnostics.get(key)?.get(uri) ?? []);
      };
      const wkey = `${key}::${uri}`;
      const arr = this.waiters.get(wkey) ?? [];
      arr.push(finish);
      this.waiters.set(wkey, arr);
      setTimeout(finish, timeoutMs);
    });
  }

  async shutdownAll(): Promise<void> {
    const all = [...this.clients.values()];
    this.clients.clear();
    this.diagnostics.clear();
    this.waiters.clear();
    await Promise.all(all.map((c) => c.stop().catch(() => {})));
  }

  private recordDiagnostics(
    key: string,
    uri: string,
    diags: Diagnostic[],
  ): void {
    let byUri = this.diagnostics.get(key);
    if (!byUri) {
      byUri = new Map();
      this.diagnostics.set(key, byUri);
    }
    byUri.set(uri, diags);
    const wkey = `${key}::${uri}`;
    const ws = this.waiters.get(wkey);
    if (ws) {
      this.waiters.delete(wkey);
      for (const w of ws) w();
    }
  }

  private keyFor(projectRoot: string, language: LanguageId): string | null {
    const spec = serversFor(language).find((s) => this.isOnPath(s.command));
    return spec ? clientKey(projectRoot, spec.command) : null;
  }
}

function clientKey(projectRoot: string, command: string): string {
  return `${projectRoot}::${command}`;
}

function defaultCreateClient(
  spec: ResolvedSpec,
  onDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void,
): LspClient {
  return new LspClient({
    command: spec.command,
    args: spec.args,
    rootPath: spec.projectRoot,
    onDiagnostics,
  });
}

let globalManager: LspServerManager | null = null;

export function getGlobalServerManager(): LspServerManager {
  if (!globalManager) globalManager = new LspServerManager();
  return globalManager;
}

export function resetGlobalServerManager(): void {
  globalManager = null;
}

/** Replace the process-global manager (tests inject a mock-backed manager). */
export function setGlobalServerManager(manager: LspServerManager): void {
  globalManager = manager;
}
