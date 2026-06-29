/**
 * LSP service — the seam between MCP tools and the real stdio LSP tier.
 *
 * Centralizes the PUNTAX_LSP gate and wraps the low-level operations so that
 * tools can reach for LSP first and fall through to the code-map / regex tiers
 * on any miss. Every helper is fail-open: disabled flag, missing server, parse
 * error, or timeout all collapse to `null` so the caller's existing path runs.
 *
 * Servers are spawned lazily by the shared global server manager and reused
 * across calls; `shutdownLsp()` tears them down on MCP-server exit.
 */

import * as path from "path";

import { loadPuntaxConfig } from "../config/puntax-config";
import {
  definition as lspDefinitionOp,
  references as lspReferencesOp,
  hover as lspHoverOp,
  documentSymbols as lspDocumentSymbolsOp,
  diagnostics as lspDiagnosticsOp,
  type Position,
} from "./operations";
import { getGlobalServerManager } from "./server-manager";
import type { SymbolInfo, SymbolLocation, Reference, HoverInfo } from "./types";
import type { Diagnostic } from "./client";

/** True when the LSP tier is enabled (config + PUNTAX_LSP env). */
export function lspEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return loadPuntaxConfig({ env }).lsp.enabled;
}

/** Canonical project root passed to the server manager / LSP rootPath. */
function lspRoot(projectPath: string): string {
  return path.resolve(projectPath);
}

/**
 * Document symbols for a file via LSP, or null when disabled/unavailable.
 * Used by symbol_context to locate a named symbol before hovering it.
 */
export async function lspDocumentSymbols(
  filePathAbs: string,
  projectPath: string,
): Promise<SymbolInfo[] | null> {
  if (!lspEnabled()) return null;
  try {
    const res = await lspDocumentSymbolsOp(filePathAbs, {
      projectRoot: lspRoot(projectPath),
    });
    return res.success && res.data ? res.data : null;
  } catch {
    return null;
  }
}

/** Definition locations for a position via LSP, or null when unavailable. */
export async function lspDefinition(
  filePathAbs: string,
  pos: Position,
  projectPath: string,
): Promise<SymbolLocation[] | null> {
  if (!lspEnabled()) return null;
  try {
    const res = await lspDefinitionOp(filePathAbs, pos, {
      projectRoot: lspRoot(projectPath),
    });
    return res.success && res.data ? res.data : null;
  } catch {
    return null;
  }
}

/** Reference locations for a position via LSP, or null when unavailable. */
export async function lspReferences(
  filePathAbs: string,
  pos: Position,
  projectPath: string,
  includeDeclaration = false,
): Promise<Reference[] | null> {
  if (!lspEnabled()) return null;
  try {
    const res = await lspReferencesOp(filePathAbs, pos, {
      projectRoot: lspRoot(projectPath),
      includeDeclaration,
    });
    return res.success && res.data ? res.data : null;
  } catch {
    return null;
  }
}

/** Hover (type/doc) for a position via LSP, or null when unavailable. */
export async function lspHover(
  filePathAbs: string,
  pos: Position,
  projectPath: string,
): Promise<HoverInfo | null> {
  if (!lspEnabled()) return null;
  try {
    const res = await lspHoverOp(filePathAbs, pos, {
      projectRoot: lspRoot(projectPath),
    });
    return res.success && res.data ? res.data : null;
  } catch {
    return null;
  }
}

/** Push diagnostics for a file via LSP, or null when unavailable. */
export async function lspDiagnostics(
  filePathAbs: string,
  projectPath: string,
): Promise<Diagnostic[] | null> {
  if (!lspEnabled()) return null;
  try {
    const res = await lspDiagnosticsOp(filePathAbs, {
      projectRoot: lspRoot(projectPath),
    });
    return res.success && res.data ? res.data : null;
  } catch {
    return null;
  }
}

/** Stop all spawned language servers. Safe to call when none were started. */
export async function shutdownLsp(): Promise<void> {
  try {
    await getGlobalServerManager().shutdownAll();
  } catch {
    // Best-effort teardown — never throw on exit.
  }
}
