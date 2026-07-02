/**
 * Steering store — mission charter + refactor manifest (MCP-server runtime)
 *
 * The long-session steering substrate:
 *
 *   charter.json    a small JSON object holding the session's mission statement,
 *                   scope (path prefixes), and hard constraints. Re-injected
 *                   VERBATIM after every compaction — never summarized, so the
 *                   goal cannot drift through lossy re-summarization.
 *   manifest.jsonl  an append-only work-list ledger for refactors: add/tick/drop
 *                   ops folded on read. Append-only means concurrent writers
 *                   (MCP server + post-edit hook) never race a read-modify-write;
 *                   ticking an already-ticked item is a harmless no-op.
 *
 * A parallel .mjs twin lives at hooks/unified/modules/steering-store.mjs —
 * keep the two in lockstep (same fold semantics, same id derivation).
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { contextPaths, ensureDir } from "./paths";

// =============================================================================
// Types
// =============================================================================

export interface Charter {
  version: 1;
  mission: string;
  scope: string[];
  constraints: string[];
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CharterInput {
  mission: string;
  scope?: string[];
  constraints?: string[];
  sessionId?: string | null;
}

export type ManifestStatus = "pending" | "done" | "dropped";

export interface ManifestItem {
  id: string;
  file: string;
  symbol?: string;
  note?: string;
  status: ManifestStatus;
  addedAt: string;
  updatedAt: string;
}

export interface ManifestItemInput {
  file: string;
  symbol?: string;
  note?: string;
}

export interface ManifestState {
  items: ManifestItem[];
  total: number;
  remaining: number;
  done: number;
  dropped: number;
}

// =============================================================================
// Path normalization
// =============================================================================

/** Repo-relative posix path: absolute paths are made relative to projectDir. */
export function normalizeRelPath(projectDir: string, file: string): string {
  let p = file.trim();
  if (path.isAbsolute(p)) {
    p = path.relative(projectDir, p);
  }
  return p.split(path.sep).join("/").replace(/^\.\//, "");
}

/** True when a repo-relative file falls under any of the scope prefixes. */
export function isInScope(scope: string[], relFile: string): boolean {
  if (!Array.isArray(scope) || scope.length === 0) return true;
  return scope.some((prefix) => {
    const pre = prefix.replace(/\/+$/, "");
    return relFile === pre || relFile.startsWith(pre + "/");
  });
}

// =============================================================================
// Charter
// =============================================================================

/** Read the charter, or null when absent/corrupt (fail-open). */
export function readCharter(projectDir: string): Charter | null {
  const file = contextPaths(projectDir).charter;
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!parsed || typeof parsed.mission !== "string" || !parsed.mission.trim()) {
      return null;
    }
    return {
      version: 1,
      mission: parsed.mission,
      scope: Array.isArray(parsed.scope) ? parsed.scope.filter((s: unknown) => typeof s === "string" && s) : [],
      constraints: Array.isArray(parsed.constraints)
        ? parsed.constraints.filter((s: unknown) => typeof s === "string" && s)
        : [],
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Write (or overwrite) the charter atomically. Preserves createdAt on update. */
export function writeCharter(projectDir: string, input: CharterInput): Charter {
  if (!input.mission || !input.mission.trim()) {
    throw new Error("charter mission must be a non-empty string");
  }
  const paths = contextPaths(projectDir);
  ensureDir(paths.dir);
  const existing = readCharter(projectDir);
  const now = new Date().toISOString();
  const charter: Charter = {
    version: 1,
    mission: input.mission,
    scope: (input.scope ?? []).map((s) => normalizeRelPath(projectDir, s)),
    constraints: input.constraints ?? [],
    sessionId: input.sessionId ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const tmp = paths.charter + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(charter, null, 2) + "\n");
  fs.renameSync(tmp, paths.charter);
  return charter;
}

/** Remove the charter (end of the steered stretch). No-op when absent. */
export function clearCharter(projectDir: string): boolean {
  const file = contextPaths(projectDir).charter;
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

// =============================================================================
// Manifest
// =============================================================================

/** Content-addressed work-item id: stable across re-adds of the same item. */
export function manifestItemId(projectDir: string, item: ManifestItemInput): string {
  const rel = normalizeRelPath(projectDir, item.file);
  const key = `${rel}|${item.symbol ?? ""}|${item.note ?? ""}`;
  return "wi_" + crypto.createHash("sha1").update(key).digest("hex").slice(0, 12);
}

interface ManifestOp {
  op: "add" | "tick" | "drop";
  id: string;
  file?: string;
  symbol?: string;
  note?: string;
  reason?: string;
  ts: string;
}

function appendOps(projectDir: string, ops: ManifestOp[]): void {
  if (ops.length === 0) return;
  const paths = contextPaths(projectDir);
  ensureDir(paths.dir);
  const lines = ops.map((o) => JSON.stringify(o)).join("\n") + "\n";
  fs.appendFileSync(paths.manifest, lines);
}

/** Fold the ops ledger into current item state (line order wins). */
export function readManifest(projectDir: string): ManifestState {
  const file = contextPaths(projectDir).manifest;
  const items = new Map<string, ManifestItem>();
  if (fs.existsSync(file)) {
    let raw = "";
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch {
      raw = "";
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let op: ManifestOp;
      try {
        op = JSON.parse(line);
      } catch {
        continue; // tolerate corrupt lines
      }
      if (!op || typeof op.id !== "string") continue;
      if (op.op === "add" && typeof op.file === "string") {
        const prior = items.get(op.id);
        items.set(op.id, {
          id: op.id,
          file: op.file,
          ...(op.symbol ? { symbol: op.symbol } : {}),
          ...(op.note ? { note: op.note } : {}),
          status: "pending",
          addedAt: prior?.addedAt ?? op.ts,
          updatedAt: op.ts,
        });
      } else if (op.op === "tick" || op.op === "drop") {
        const item = items.get(op.id);
        if (item) {
          item.status = op.op === "tick" ? "done" : "dropped";
          item.updatedAt = op.ts;
        }
      }
    }
  }
  const all = [...items.values()];
  return {
    items: all,
    total: all.length,
    remaining: all.filter((i) => i.status === "pending").length,
    done: all.filter((i) => i.status === "done").length,
    dropped: all.filter((i) => i.status === "dropped").length,
  };
}

/** Add work items (deduped by content-addressed id). Returns the added ids. */
export function manifestAdd(projectDir: string, inputs: ManifestItemInput[]): string[] {
  const now = new Date().toISOString();
  const state = readManifest(projectDir);
  const known = new Set(state.items.filter((i) => i.status === "pending").map((i) => i.id));
  const ops: ManifestOp[] = [];
  const ids: string[] = [];
  for (const input of inputs) {
    if (!input || typeof input.file !== "string" || !input.file.trim()) continue;
    const rel = normalizeRelPath(projectDir, input.file);
    const id = manifestItemId(projectDir, input);
    ids.push(id);
    if (known.has(id)) continue; // already pending — re-add is a no-op
    known.add(id);
    ops.push({
      op: "add",
      id,
      file: rel,
      ...(input.symbol ? { symbol: input.symbol } : {}),
      ...(input.note ? { note: input.note } : {}),
      ts: now,
    });
  }
  appendOps(projectDir, ops);
  return ids;
}

/** Tick items done by id. Unknown ids are ignored. Returns ticked ids. */
export function manifestTick(projectDir: string, ids: string[]): string[] {
  const now = new Date().toISOString();
  const state = readManifest(projectDir);
  const pending = new Set(state.items.filter((i) => i.status === "pending").map((i) => i.id));
  const ticked = ids.filter((id) => pending.has(id));
  appendOps(
    projectDir,
    ticked.map((id) => ({ op: "tick" as const, id, ts: now })),
  );
  return ticked;
}

/** Tick every pending item whose file matches. Returns the ticked items. */
export function manifestTickByFile(projectDir: string, file: string): ManifestItem[] {
  const rel = normalizeRelPath(projectDir, file);
  const state = readManifest(projectDir);
  const matches = state.items.filter((i) => i.status === "pending" && i.file === rel);
  manifestTick(
    projectDir,
    matches.map((i) => i.id),
  );
  return matches;
}

/** Drop items (won't-do). Returns dropped ids. */
export function manifestDrop(projectDir: string, ids: string[], reason?: string): string[] {
  const now = new Date().toISOString();
  const state = readManifest(projectDir);
  const pending = new Set(state.items.filter((i) => i.status === "pending").map((i) => i.id));
  const dropped = ids.filter((id) => pending.has(id));
  appendOps(
    projectDir,
    dropped.map((id) => ({ op: "drop" as const, id, ...(reason ? { reason } : {}), ts: now })),
  );
  return dropped;
}

/** Remove the manifest ledger entirely. No-op when absent. */
export function clearManifest(projectDir: string): boolean {
  const file = contextPaths(projectDir).manifest;
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
