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
import { appendFileSync, readFileSync } from 'node:fs';
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
