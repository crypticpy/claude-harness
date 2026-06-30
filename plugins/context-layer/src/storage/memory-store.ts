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

export interface AppendBatchResult {
  written: number;
  results: AppendResult[];
}

/**
 * Batch sibling of appendMemory (TS mirror of the hook-side `appendMemories`):
 * validate, dedup (against the store AND within the batch), and append all
 * survivors with ONE store read and ONE write. appendMemory re-reads the whole
 * store on every call, so writing K candidates against N existing rows is
 * O(K·N); this collapses it to O(N+K). Per-item semantics match appendMemory
 * exactly; the only addition is intra-batch dedup. Results are in input order.
 */
export function appendMemories(
  projectDir: string,
  inputs: MemoryInput[],
): AppendBatchResult {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return { written: 0, results: [] };
  }
  const file = memoriesPath(projectDir);
  ensureDir(path.dirname(file));
  const seen = new Set(readMemories(projectDir).map((m) => m.id)); // single read
  const results: AppendResult[] = [];
  const lines: string[] = [];
  for (const input of inputs) {
    const mem = normalizeMemory(input);
    const check = validateMemory(mem);
    if (!check.valid) {
      results.push({
        written: false,
        id: mem.id,
        reason: "invalid",
        errors: check.errors,
      });
      continue;
    }
    if (seen.has(mem.id)) {
      results.push({ written: false, id: mem.id, reason: "duplicate" });
      continue;
    }
    seen.add(mem.id);
    lines.push(JSON.stringify(mem));
    results.push({ written: true, id: mem.id });
  }
  if (lines.length) fs.appendFileSync(file, lines.join("\n") + "\n"); // single write
  return { written: lines.length, results };
}

const DEFAULT_KIND_CAP = 50;
const SEVERITY_RANK: Record<string, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

export interface PruneByReason {
  corrupt: number;
  invalid: number;
  nonActive: number;
  expired: number;
  junk: number;
  duplicate: number;
  overCap: number;
}

export interface PruneMemoriesResult {
  kept: number;
  dropped: number;
  byReason: PruneByReason;
}

/**
 * Conservative retention GC for memories.jsonl — the TS mirror of the hook-side
 * `pruneMemories` (keep the two in lockstep). The store is otherwise append-only,
 * so without this nothing ever leaves: expired observations, superseded/rejected
 * rows, and unbounded growth all linger and pollute recall. Rewrites the file
 * (atomic temp+rename) dropping, in order:
 *   1. corrupt / schema-invalid lines
 *   2. non-active rows (status in {superseded, expired, rejected})
 *   3. expired rows (expiresAt <= now)
 *   4. quality junk: rows for which the optional caller-injected `opts.dropJunk`
 *      predicate returns true (e.g. a legacy mis-tagged test_command).
 *   5. duplicate-id rows: keep the first occurrence, drop the rest (self-heals a
 *      cross-process append race that slipped the same id in twice).
 *   6. over-cap rows per (kind, scope): keep the newest `kindCap`; user-confirmed
 *      and higher-severity rows are preferred so durable user knowledge survives.
 * Returns { kept, dropped, byReason } where byReason breaks the drops into
 * { corrupt, invalid, nonActive, expired, junk, duplicate, overCap } for observability.
 */
export function pruneMemories(
  projectDir: string,
  opts: {
    now?: number;
    kindCap?: number;
    dropJunk?: (m: TypedMemory) => boolean;
  } = {},
): PruneMemoriesResult {
  const zero = (): PruneByReason => ({
    corrupt: 0,
    invalid: 0,
    nonActive: 0,
    expired: 0,
    junk: 0,
    duplicate: 0,
    overCap: 0,
  });
  try {
    const file = memoriesPath(projectDir);
    if (!fs.existsSync(file)) return { kept: 0, dropped: 0, byReason: zero() };
    const now = typeof opts.now === "number" ? opts.now : Date.now();
    const kindCap =
      typeof opts.kindCap === "number" ? opts.kindCap : DEFAULT_KIND_CAP;
    // Optional caller-injected quality filter (keeps the store classifier-agnostic).
    const dropJunk = typeof opts.dropJunk === "function" ? opts.dropJunk : null;

    const byReason = zero();
    let total = 0;
    const seenIds = new Set<string>();
    const survivors: Array<{ m: TypedMemory; line: string }> = [];
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      total++;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        byReason.corrupt++;
        continue; // drop corrupt
      }
      if (!validateMemory(parsed).valid) {
        byReason.invalid++;
        continue; // drop schema-invalid
      }
      const m = parsed as TypedMemory;
      if (m.status && m.status !== "active") {
        byReason.nonActive++;
        continue; // drop non-active
      }
      if (m.expiresAt) {
        const exp = Date.parse(m.expiresAt);
        // A present-but-unparseable expiry is corrupt — drop it (fail-safe)
        // rather than letting NaN <= now (false) keep it in the store forever.
        if (Number.isNaN(exp) || exp <= now) {
          byReason.expired++;
          continue; // drop expired
        }
      }
      if (dropJunk) {
        let junk = false;
        try {
          junk = dropJunk(m) === true;
        } catch {
          junk = false; // a throwing predicate never drops
        }
        if (junk) {
          byReason.junk++;
          continue;
        }
      }
      // Collapse duplicate ids: appendMemory dedups within a process, but a
      // cross-process append race (the .mjs hook runtime vs the MCP server) can
      // slip the same content-addressed id in twice. Keep the first, drop the rest.
      if (seenIds.has(m.id)) {
        byReason.duplicate++;
        continue;
      }
      seenIds.add(m.id);
      survivors.push({ m, line });
    }

    const importance = (m: TypedMemory) => ({
      conf: m.confidence === "user_confirmed" ? 1 : 0,
      sev: SEVERITY_RANK[m.severity] ?? 0,
      createdAt: typeof m.createdAt === "string" ? m.createdAt : "",
    });

    const groups = new Map<string, Array<{ m: TypedMemory; line: string }>>();
    for (const s of survivors) {
      const key = `${s.m.kind}\x00${s.m.scope}`;
      const g = groups.get(key);
      if (g) g.push(s);
      else groups.set(key, [s]);
    }
    const keep = new Set<{ m: TypedMemory; line: string }>();
    for (const g of groups.values()) {
      if (g.length <= kindCap) {
        for (const s of g) keep.add(s);
        continue;
      }
      const ranked = [...g].sort((a, b) => {
        const A = importance(a.m);
        const B = importance(b.m);
        if (A.conf !== B.conf) return B.conf - A.conf;
        if (A.sev !== B.sev) return B.sev - A.sev;
        return B.createdAt.localeCompare(A.createdAt);
      });
      for (const s of ranked.slice(0, kindCap)) keep.add(s);
    }

    const kept = survivors.filter((s) => keep.has(s));
    byReason.overCap = survivors.length - kept.length;
    const dropped = total - kept.length;
    if (dropped > 0) {
      const data = kept.length ? kept.map((s) => s.line).join("\n") + "\n" : "";
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, file); // atomic swap so a crash can't truncate the store
    }
    return { kept: kept.length, dropped, byReason };
  } catch {
    return { kept: 0, dropped: 0, byReason: zero() };
  }
}
