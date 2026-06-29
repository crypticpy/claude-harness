/**
 * Typed memory store (project-local memories.jsonl).
 *
 * Append-only JSONL of provenance-tagged memories per
 * `schemas/memory.schema.json`. Writes are validated and content-addressed:
 * the id is a deterministic hash of (projectId, kind, scope, text), so the same
 * memory written twice collapses to one row (no poisoning by repetition).
 *
 * Defensive throughout: invalid input is rejected (never written), and corrupt
 * lines on read are skipped rather than throwing — a single bad line must not
 * blind every consumer.
 *
 * This is the TypeScript side of a cross-runtime contract: the hook-side writer
 * (`hooks/unified/modules/memory-store.mjs`, Phase 5b distillation) emits the
 * identical row shape and id, so both runtimes share one memories.jsonl.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { contextPaths, ensureDir } from "./paths";

export const MEMORY_KINDS = [
  "decision",
  "gotcha",
  "convention",
  "api_contract",
  "test_command",
  "failure_pattern",
  "user_preference",
  "project_fact",
  "permission_rule_candidate",
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_SCOPES = [
  "global",
  "project",
  "repo",
  "file",
  "symbol",
] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type MemorySeverity = (typeof MEMORY_SEVERITIES)[number];

export const MEMORY_CONFIDENCES = [
  "observed",
  "user_confirmed",
  "inferred",
  "llm_distilled",
  "imported",
] as const;
export type MemoryConfidence = (typeof MEMORY_CONFIDENCES)[number];

export const PROVENANCE_SOURCES = [
  "user",
  "event",
  "test_failure",
  "diagnostic",
  "source",
  "llm",
  "migration",
  "manual",
] as const;
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];

export const MEMORY_STATUSES = [
  "active",
  "superseded",
  "expired",
  "rejected",
] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export interface MemoryProvenance {
  source: ProvenanceSource;
  eventIds?: string[];
  sourcePath?: string | null;
  notes?: string | null;
}

export interface TypedMemory {
  id: string;
  projectId: string;
  kind: MemoryKind;
  scope: MemoryScope;
  text: string;
  files: string[];
  symbols: string[];
  severity: MemorySeverity;
  confidence: MemoryConfidence;
  provenance: MemoryProvenance;
  createdAt: string;
  expiresAt?: string | null;
  status: MemoryStatus;
}

const MAX_TEXT = 4000;

/** Content-addressed memory id (stable across runtimes; drives dedup). */
export function memoryId(
  projectId: string,
  kind: string,
  scope: string,
  text: string,
): string {
  const h = crypto
    .createHash("sha1")
    .update([projectId, kind, scope, text].join("\x00"))
    .digest("hex");
  return "mem_" + h.slice(0, 20);
}

export interface MemoryInput {
  projectId: string;
  kind: MemoryKind;
  scope: MemoryScope;
  text: string;
  severity: MemorySeverity;
  confidence: MemoryConfidence;
  provenance: MemoryProvenance;
  files?: string[];
  symbols?: string[];
  expiresAt?: string | null;
  status?: MemoryStatus;
  createdAt?: string;
}

/**
 * Fill defaults and compute the deterministic id. Does NOT validate — call
 * `validateMemory` on the result before persisting.
 */
export function normalizeMemory(input: MemoryInput): TypedMemory {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    id: memoryId(input.projectId, input.kind, input.scope, input.text),
    projectId: input.projectId,
    kind: input.kind,
    scope: input.scope,
    text: input.text,
    files: input.files ?? [],
    symbols: input.symbols ?? [],
    severity: input.severity,
    confidence: input.confidence,
    provenance: {
      source: input.provenance.source,
      ...(input.provenance.eventIds
        ? { eventIds: input.provenance.eventIds }
        : {}),
      ...(input.provenance.sourcePath !== undefined
        ? { sourcePath: input.provenance.sourcePath }
        : {}),
      ...(input.provenance.notes !== undefined
        ? { notes: input.provenance.notes }
        : {}),
    },
    createdAt,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    status: input.status ?? "active",
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function inEnum(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

/** Validate a memory object against the schema's structural rules. */
export function validateMemory(obj: unknown): ValidationResult {
  const errors: string[] = [];
  if (obj === null || typeof obj !== "object") {
    return { valid: false, errors: ["memory is not an object"] };
  }
  const m = obj as Record<string, unknown>;

  if (typeof m.id !== "string" || !/^mem_[A-Za-z0-9_-]+$/.test(m.id)) {
    errors.push("id must match ^mem_[A-Za-z0-9_-]+$");
  }
  if (typeof m.projectId !== "string" || m.projectId.length === 0) {
    errors.push("projectId is required");
  }
  if (!inEnum(m.kind, MEMORY_KINDS)) errors.push("kind is invalid");
  if (!inEnum(m.scope, MEMORY_SCOPES)) errors.push("scope is invalid");
  if (typeof m.text !== "string" || m.text.length < 1) {
    errors.push("text is required");
  } else if (m.text.length > MAX_TEXT) {
    errors.push(`text exceeds ${MAX_TEXT} chars`);
  }
  if (!inEnum(m.severity, MEMORY_SEVERITIES))
    errors.push("severity is invalid");
  if (!inEnum(m.confidence, MEMORY_CONFIDENCES)) {
    errors.push("confidence is invalid");
  }
  const prov = m.provenance as Record<string, unknown> | undefined;
  if (!prov || typeof prov !== "object") {
    errors.push("provenance is required");
  } else if (!inEnum(prov.source, PROVENANCE_SOURCES)) {
    errors.push("provenance.source is invalid");
  }
  if (typeof m.createdAt !== "string" || m.createdAt.length === 0) {
    errors.push("createdAt is required");
  }
  if (m.status !== undefined && !inEnum(m.status, MEMORY_STATUSES)) {
    errors.push("status is invalid");
  }
  return { valid: errors.length === 0, errors };
}

export interface AppendResult {
  written: boolean;
  id: string;
  reason?: "duplicate" | "invalid";
  errors?: string[];
}

/** Repo-relative memories.jsonl path for a project. */
export function memoriesPath(projectDir: string): string {
  return contextPaths(projectDir).memories;
}

/** Parse memories.jsonl defensively (skip corrupt/blank lines). */
export function readMemories(projectDir: string): TypedMemory[] {
  const file = memoriesPath(projectDir);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  const out: TypedMemory[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (validateMemory(obj).valid) out.push(obj as TypedMemory);
    } catch {
      // skip corrupt line
    }
  }
  return out;
}

/**
 * Validate, dedup by id, and append a memory. Returns whether it was written.
 * An exact-duplicate (same id already present) is a no-op success-ish result
 * with `written: false, reason: "duplicate"`; invalid input is rejected.
 */
export function appendMemory(
  projectDir: string,
  input: MemoryInput,
): AppendResult {
  const mem = normalizeMemory(input);
  const check = validateMemory(mem);
  if (!check.valid) {
    return {
      written: false,
      id: mem.id,
      reason: "invalid",
      errors: check.errors,
    };
  }
  const file = memoriesPath(projectDir);
  ensureDir(path.dirname(file));

  for (const existing of readMemories(projectDir)) {
    if (existing.id === mem.id) {
      return { written: false, id: mem.id, reason: "duplicate" };
    }
  }
  fs.appendFileSync(file, JSON.stringify(mem) + "\n");
  return { written: true, id: mem.id };
}
