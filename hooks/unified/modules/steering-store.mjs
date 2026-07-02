/**
 * Steering store — mission charter + refactor manifest (hook runtime)
 *
 * .mjs twin of plugins/context-layer/src/storage/steering-store.ts — keep the
 * two in lockstep (same fold semantics, same content-addressed id derivation).
 *
 *   charter.json    the session's mission/scope/constraints, re-injected
 *                   VERBATIM after every compaction.
 *   manifest.jsonl  append-only add/tick/drop work-list ledger, folded on read.
 *                   Append-only means the MCP server and the post-edit hook
 *                   never race a read-modify-write; double-ticks are no-ops.
 */

import { createHash } from 'crypto';
import { appendFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { isAbsolute, relative, sep } from 'path';

import { contextPaths, ensureDir } from './storage-paths.mjs';

// =============================================================================
// Path normalization
// =============================================================================

/** Repo-relative posix path: absolute paths are made relative to projectDir. */
export function normalizeRelPath(projectDir, file) {
  let p = String(file).trim();
  if (isAbsolute(p)) {
    p = relative(projectDir, p);
  }
  return p.split(sep).join('/').replace(/^\.\//, '');
}

/** True when a repo-relative file falls under any of the scope prefixes. */
export function isInScope(scope, relFile) {
  if (!Array.isArray(scope) || scope.length === 0) return true;
  return scope.some((prefix) => {
    const pre = String(prefix).replace(/\/+$/, '');
    return relFile === pre || relFile.startsWith(pre + '/');
  });
}

// =============================================================================
// Charter
// =============================================================================

/** Read the charter, or null when absent/corrupt (fail-open). */
export function readCharter(projectDir) {
  const file = contextPaths(projectDir).charter;
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    if (!parsed || typeof parsed.mission !== 'string' || !parsed.mission.trim()) {
      return null;
    }
    return {
      version: 1,
      mission: parsed.mission,
      scope: Array.isArray(parsed.scope) ? parsed.scope.filter((s) => typeof s === 'string' && s) : [],
      constraints: Array.isArray(parsed.constraints)
        ? parsed.constraints.filter((s) => typeof s === 'string' && s)
        : [],
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Write (or overwrite) the charter atomically. Preserves createdAt on update. */
export function writeCharter(projectDir, input) {
  if (!input?.mission || !String(input.mission).trim()) {
    throw new Error('charter mission must be a non-empty string');
  }
  const paths = contextPaths(projectDir);
  ensureDir(paths.dir);
  const existing = readCharter(projectDir);
  const now = new Date().toISOString();
  const charter = {
    version: 1,
    mission: input.mission,
    scope: (input.scope ?? []).map((s) => normalizeRelPath(projectDir, s)),
    constraints: input.constraints ?? [],
    sessionId: input.sessionId ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const tmp = paths.charter + '.tmp';
  writeFileSync(tmp, JSON.stringify(charter, null, 2) + '\n');
  renameSync(tmp, paths.charter);
  return charter;
}

/** Remove the charter (end of the steered stretch). No-op when absent. */
export function clearCharter(projectDir) {
  const file = contextPaths(projectDir).charter;
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

// =============================================================================
// Manifest
// =============================================================================

/** Content-addressed work-item id: stable across re-adds of the same item. */
export function manifestItemId(projectDir, item) {
  const rel = normalizeRelPath(projectDir, item.file);
  const key = `${rel}|${item.symbol ?? ''}|${item.note ?? ''}`;
  return 'wi_' + createHash('sha1').update(key).digest('hex').slice(0, 12);
}

function appendOps(projectDir, ops) {
  if (ops.length === 0) return;
  const paths = contextPaths(projectDir);
  ensureDir(paths.dir);
  const lines = ops.map((o) => JSON.stringify(o)).join('\n') + '\n';
  appendFileSync(paths.manifest, lines);
}

/** Fold the ops ledger into current item state (line order wins). */
export function readManifest(projectDir) {
  const file = contextPaths(projectDir).manifest;
  const items = new Map();
  if (existsSync(file)) {
    let raw = '';
    try {
      raw = readFileSync(file, 'utf-8');
    } catch {
      raw = '';
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let op;
      try {
        op = JSON.parse(line);
      } catch {
        continue; // tolerate corrupt lines
      }
      if (!op || typeof op.id !== 'string') continue;
      if (op.op === 'add' && typeof op.file === 'string') {
        const prior = items.get(op.id);
        items.set(op.id, {
          id: op.id,
          file: op.file,
          ...(op.symbol ? { symbol: op.symbol } : {}),
          ...(op.note ? { note: op.note } : {}),
          status: 'pending',
          addedAt: prior?.addedAt ?? op.ts,
          updatedAt: op.ts,
        });
      } else if (op.op === 'tick' || op.op === 'drop') {
        const item = items.get(op.id);
        if (item) {
          item.status = op.op === 'tick' ? 'done' : 'dropped';
          item.updatedAt = op.ts;
        }
      }
    }
  }
  const all = [...items.values()];
  return {
    items: all,
    total: all.length,
    remaining: all.filter((i) => i.status === 'pending').length,
    done: all.filter((i) => i.status === 'done').length,
    dropped: all.filter((i) => i.status === 'dropped').length,
  };
}

/** Add work items (deduped by content-addressed id). Returns the added ids. */
export function manifestAdd(projectDir, inputs) {
  const now = new Date().toISOString();
  const state = readManifest(projectDir);
  const known = new Set(state.items.filter((i) => i.status === 'pending').map((i) => i.id));
  const ops = [];
  const ids = [];
  for (const input of inputs) {
    if (!input || typeof input.file !== 'string' || !input.file.trim()) continue;
    const rel = normalizeRelPath(projectDir, input.file);
    const id = manifestItemId(projectDir, input);
    ids.push(id);
    if (known.has(id)) continue; // already pending — re-add is a no-op
    known.add(id);
    ops.push({
      op: 'add',
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
export function manifestTick(projectDir, ids) {
  const now = new Date().toISOString();
  const state = readManifest(projectDir);
  const pending = new Set(state.items.filter((i) => i.status === 'pending').map((i) => i.id));
  const ticked = ids.filter((id) => pending.has(id));
  appendOps(
    projectDir,
    ticked.map((id) => ({ op: 'tick', id, ts: now })),
  );
  return ticked;
}

/** Tick every pending item whose file matches. Returns the ticked items. */
export function manifestTickByFile(projectDir, file) {
  const rel = normalizeRelPath(projectDir, file);
  const state = readManifest(projectDir);
  const matches = state.items.filter((i) => i.status === 'pending' && i.file === rel);
  manifestTick(
    projectDir,
    matches.map((i) => i.id),
  );
  return matches;
}

/** Drop items (won't-do). Returns dropped ids. */
export function manifestDrop(projectDir, ids, reason) {
  const now = new Date().toISOString();
  const state = readManifest(projectDir);
  const pending = new Set(state.items.filter((i) => i.status === 'pending').map((i) => i.id));
  const dropped = ids.filter((id) => pending.has(id));
  appendOps(
    projectDir,
    dropped.map((id) => ({ op: 'drop', id, ...(reason ? { reason } : {}), ts: now })),
  );
  return dropped;
}

export default {
  normalizeRelPath,
  isInScope,
  readCharter,
  writeCharter,
  clearCharter,
  manifestItemId,
  readManifest,
  manifestAdd,
  manifestTick,
  manifestTickByFile,
  manifestDrop,
};
