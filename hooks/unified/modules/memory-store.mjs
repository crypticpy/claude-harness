/**
 * Typed memory store (hook runtime) — mirror of
 * plugins/context-layer/src/storage/memory-store.ts.
 *
 * Keep the two in lockstep: identical id algorithm and row shape so the MCP
 * server (memory_write) and the hooks (Phase 5 distillation) share one
 * memories.jsonl. The TS side is the source of truth for the schema; this is
 * the JS writer used by distill-precompact.
 *
 * Defensive throughout: invalid input is never written; corrupt lines on read
 * are skipped rather than thrown.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { contextPaths, ensureDir } from './storage-paths.mjs';

export const MEMORY_KINDS = [
  'decision',
  'gotcha',
  'convention',
  'api_contract',
  'test_command',
  'failure_pattern',
  'user_preference',
  'project_fact',
  'permission_rule_candidate',
];
export const MEMORY_SCOPES = ['global', 'project', 'repo', 'file', 'symbol'];
export const MEMORY_SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const MEMORY_CONFIDENCES = [
  'observed',
  'user_confirmed',
  'inferred',
  'llm_distilled',
  'imported',
];
export const PROVENANCE_SOURCES = [
  'user',
  'event',
  'test_failure',
  'diagnostic',
  'source',
  'llm',
  'migration',
  'manual',
];
export const MEMORY_STATUSES = ['active', 'superseded', 'expired', 'rejected'];

const MAX_TEXT = 4000;

function sha1(...parts) {
  return createHash('sha1').update(parts.join('\x00')).digest('hex');
}

/**
 * Deterministic project id from its absolute root path (mirrors code-map.ts).
 * Resolves internally so callers passing a cwd-relative path key the same
 * project as callers passing an absolute one — otherwise the same memory gets
 * two ids (projectId feeds memoryId) and dedup silently fails.
 */
export function projectIdFor(rootPath) {
  return 'prj_' + sha1(resolve(rootPath)).slice(0, 20);
}

/** Content-addressed memory id (must match the TS memoryId). */
export function memoryId(projectId, kind, scope, text) {
  return 'mem_' + sha1(projectId, kind, scope, text).slice(0, 20);
}

/** Fill defaults + compute id. Does NOT validate. */
export function normalizeMemory(input) {
  const provenance = { source: input.provenance.source };
  if (input.provenance.eventIds) provenance.eventIds = input.provenance.eventIds;
  if (input.provenance.sourcePath !== undefined) provenance.sourcePath = input.provenance.sourcePath;
  if (input.provenance.notes !== undefined) provenance.notes = input.provenance.notes;

  const mem = {
    id: memoryId(input.projectId, input.kind, input.scope, input.text),
    projectId: input.projectId,
    kind: input.kind,
    scope: input.scope,
    text: input.text,
    files: input.files ?? [],
    symbols: input.symbols ?? [],
    severity: input.severity,
    confidence: input.confidence,
    provenance,
    createdAt: input.createdAt ?? new Date().toISOString(),
    status: input.status ?? 'active',
  };
  if (input.expiresAt !== undefined) mem.expiresAt = input.expiresAt;
  return mem;
}

function inEnum(value, allowed) {
  return typeof value === 'string' && allowed.includes(value);
}

/** Structural validation matching memory.schema.json. */
export function validateMemory(obj) {
  const errors = [];
  if (obj === null || typeof obj !== 'object') {
    return { valid: false, errors: ['memory is not an object'] };
  }
  if (typeof obj.id !== 'string' || !/^mem_[A-Za-z0-9_-]+$/.test(obj.id)) {
    errors.push('id must match ^mem_[A-Za-z0-9_-]+$');
  }
  if (typeof obj.projectId !== 'string' || obj.projectId.length === 0) errors.push('projectId is required');
  if (!inEnum(obj.kind, MEMORY_KINDS)) errors.push('kind is invalid');
  if (!inEnum(obj.scope, MEMORY_SCOPES)) errors.push('scope is invalid');
  if (typeof obj.text !== 'string' || obj.text.length < 1) errors.push('text is required');
  else if (obj.text.length > MAX_TEXT) errors.push(`text exceeds ${MAX_TEXT} chars`);
  if (!inEnum(obj.severity, MEMORY_SEVERITIES)) errors.push('severity is invalid');
  if (!inEnum(obj.confidence, MEMORY_CONFIDENCES)) errors.push('confidence is invalid');
  if (!obj.provenance || typeof obj.provenance !== 'object') errors.push('provenance is required');
  else if (!inEnum(obj.provenance.source, PROVENANCE_SOURCES)) errors.push('provenance.source is invalid');
  if (typeof obj.createdAt !== 'string' || obj.createdAt.length === 0) errors.push('createdAt is required');
  if (obj.status !== undefined && !inEnum(obj.status, MEMORY_STATUSES)) errors.push('status is invalid');
  return { valid: errors.length === 0, errors };
}

/** Repo-relative memories.jsonl path. */
export function memoriesPath(projectDir) {
  return contextPaths(projectDir).memories;
}

/** Parse memories.jsonl defensively (skip corrupt/blank lines). */
export function readMemories(projectDir) {
  let raw;
  try {
    raw = readFileSync(memoriesPath(projectDir), 'utf-8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (validateMemory(obj).valid) out.push(obj);
    } catch {
      // skip corrupt
    }
  }
  return out;
}

/**
 * Validate, dedup by id, append. Returns { written, id, reason?, errors? }.
 * Exact-duplicate (same id present) -> { written: false, reason: 'duplicate' }.
 */
export function appendMemory(projectDir, input) {
  const mem = normalizeMemory(input);
  const check = validateMemory(mem);
  if (!check.valid) return { written: false, id: mem.id, reason: 'invalid', errors: check.errors };

  const file = memoriesPath(projectDir);
  ensureDir(dirname(file));
  for (const existing of readMemories(projectDir)) {
    if (existing.id === mem.id) return { written: false, id: mem.id, reason: 'duplicate' };
  }
  appendFileSync(file, JSON.stringify(mem) + '\n');
  return { written: true, id: mem.id };
}

/**
 * Batch sibling of appendMemory: validate, dedup (against the store AND within
 * the batch), and append all survivors with ONE store read and ONE write.
 * appendMemory re-reads the whole store on every call, so distilling K
 * candidates against N existing rows is O(K·N); this collapses it to O(N+K),
 * which matters on the PreCompact hot path. Per-item semantics are identical to
 * appendMemory (invalid -> 'invalid', already-present -> 'duplicate'); the only
 * addition is that two identical candidates in one batch dedup against each
 * other. Returns { written, results } with results in input order.
 *
 * @param {string} projectDir
 * @param {object[]} inputs  MemoryInput[]
 */
export function appendMemories(projectDir, inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) return { written: 0, results: [] };
  const file = memoriesPath(projectDir);
  ensureDir(dirname(file));
  const seen = new Set(readMemories(projectDir).map((m) => m.id)); // single read
  const results = [];
  const lines = [];
  for (const input of inputs) {
    const mem = normalizeMemory(input);
    const check = validateMemory(mem);
    if (!check.valid) {
      results.push({ written: false, id: mem.id, reason: 'invalid', errors: check.errors });
      continue;
    }
    if (seen.has(mem.id)) {
      results.push({ written: false, id: mem.id, reason: 'duplicate' });
      continue;
    }
    seen.add(mem.id);
    lines.push(JSON.stringify(mem));
    results.push({ written: true, id: mem.id });
  }
  if (lines.length) appendFileSync(file, lines.join('\n') + '\n'); // single write
  return { written: lines.length, results };
}

const DEFAULT_KIND_CAP = 50;
const SEVERITY_RANK = { critical: 3, high: 2, medium: 1, low: 0 };

/** Cap tie-break weight: user-confirmed and higher-severity rows survive first. */
function importanceKey(m) {
  return {
    conf: m.confidence === 'user_confirmed' ? 1 : 0,
    sev: SEVERITY_RANK[m.severity] ?? 0,
    createdAt: typeof m.createdAt === 'string' ? m.createdAt : '',
  };
}

/**
 * Conservative retention GC for memories.jsonl. The store is otherwise
 * append-only, so without this nothing ever leaves: expired observations,
 * superseded/rejected rows, and unbounded growth all linger and pollute recall.
 * Rewrites the file (atomic temp+rename) dropping, in order:
 *   1. corrupt / schema-invalid lines
 *   2. non-active rows (status in {superseded, expired, rejected})
 *   3. expired rows (expiresAt <= now)
 *   4. quality junk: rows for which the optional caller-injected `opts.dropJunk`
 *      predicate returns true (e.g. a legacy mis-tagged test_command).
 *   5. over-cap rows per (kind, scope): keep the newest `kindCap`; user-confirmed
 *      and higher-severity rows are preferred so durable user knowledge survives.
 * A user-written active row with no expiry is only ever dropped by the cap, which
 * is intentionally high (50) so that rarely fires. Returns { kept, dropped,
 * byReason } where byReason breaks the drops into { corrupt, invalid, nonActive,
 * expired, junk, overCap } for observability.
 *
 * (Refinement left for later: "touch" expiresAt on a re-observed duplicate so an
 * actively-used command never ages out — today it self-heals via re-distillation.)
 *
 * @param {string} projectDir
 * @param {{ now?: number, kindCap?: number, dropJunk?: (m:object)=>boolean }} [opts]
 */
export function pruneMemories(projectDir, opts = {}) {
  const zero = () => ({ corrupt: 0, invalid: 0, nonActive: 0, expired: 0, junk: 0, overCap: 0 });
  try {
    const file = memoriesPath(projectDir);
    if (!existsSync(file)) return { kept: 0, dropped: 0, byReason: zero() };
    const now = typeof opts.now === 'number' ? opts.now : Date.now();
    const kindCap = typeof opts.kindCap === 'number' ? opts.kindCap : DEFAULT_KIND_CAP;
    // Optional quality filter: drop a surviving row when this returns true. The
    // store stays classifier-agnostic — the caller injects the predicate (e.g.
    // "a test_command whose text no longer classifies as a test"), so legacy
    // mis-tagged rows leave without the store knowing command semantics.
    const dropJunk = typeof opts.dropJunk === 'function' ? opts.dropJunk : null;

    const byReason = zero();
    let total = 0;
    const survivors = []; // { m, line } in original order
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      total++;
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        byReason.corrupt++;
        continue; // drop corrupt
      }
      if (!validateMemory(m).valid) { byReason.invalid++; continue; } // drop schema-invalid
      if (m.status && m.status !== 'active') { byReason.nonActive++; continue; } // drop non-active
      if (m.expiresAt && Date.parse(m.expiresAt) <= now) { byReason.expired++; continue; } // drop expired
      if (dropJunk) {
        let junk = false;
        try { junk = dropJunk(m) === true; } catch { junk = false; } // a throwing predicate never drops
        if (junk) { byReason.junk++; continue; }
      }
      survivors.push({ m, line });
    }

    // Per-(kind, scope) cap.
    const groups = new Map();
    for (const s of survivors) {
      const key = s.m.kind + '\x00' + s.m.scope;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(s);
    }
    const keep = new Set();
    for (const g of groups.values()) {
      if (g.length <= kindCap) {
        for (const s of g) keep.add(s);
        continue;
      }
      const ranked = [...g].sort((a, b) => {
        const A = importanceKey(a.m);
        const B = importanceKey(b.m);
        if (A.conf !== B.conf) return B.conf - A.conf;
        if (A.sev !== B.sev) return B.sev - A.sev;
        return B.createdAt.localeCompare(A.createdAt); // newest first
      });
      for (const s of ranked.slice(0, kindCap)) keep.add(s);
    }

    const kept = survivors.filter((s) => keep.has(s));
    byReason.overCap = survivors.length - kept.length;
    const dropped = total - kept.length;
    if (dropped > 0) {
      const data = kept.length ? kept.map((s) => s.line).join('\n') + '\n' : '';
      const tmp = file + '.tmp';
      writeFileSync(tmp, data);
      renameSync(tmp, file); // atomic swap so a crash can't truncate the store
    }
    return { kept: kept.length, dropped, byReason };
  } catch (err) {
    if (process.env.DEBUG) process.stderr.write('[memory-store] prune error: ' + err.message + '\n');
    return { kept: 0, dropped: 0, byReason: zero() };
  }
}
