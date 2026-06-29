/**
 * Migration adapters: existing brain files -> typed memories.
 *
 * Pure, defensive converters that map the v1 brain artifacts into the Phase 5
 * typed-memory shape (schemas/memory.schema.json). All migrated memories are
 * tagged `confidence: "imported"`, `provenance.source: "migration"` with the
 * originating file as `sourcePath`, so they rank below freshly observed facts.
 *
 * These are NOT auto-run — they are building blocks for a one-shot import (e.g.
 * a `/puntax` maintenance command). Content-addressed dedup in the store makes
 * re-running them idempotent.
 */

import * as fs from "fs";
import * as path from "path";

import type { MemoryInput, MemorySeverity, MemoryKind } from "./memory-store";

const IMPORTED = {
  confidence: "imported" as const,
};

function migrationProvenance(sourcePath: string) {
  return { source: "migration" as const, sourcePath };
}

function riskToSeverity(risk: unknown): MemorySeverity {
  switch (risk) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
      return "medium";
    default:
      return "low";
  }
}

/** Classify a free-text lesson into a memory kind by keyword. */
function classifyLesson(text: string): MemoryKind {
  const t = text.toLowerCase();
  if (/\b(fail|failed|failure|error|broke|broken|crash|regress)/.test(t)) {
    return "failure_pattern";
  }
  if (/\b(gotcha|watch out|careful|must |never |always |beware)/.test(t)) {
    return "gotcha";
  }
  return "project_fact";
}

/** lessons.jsonl rows -> gotcha / failure_pattern / project_fact memories. */
export function lessonsToMemories(
  rows: unknown[],
  projectId: string,
): MemoryInput[] {
  const out: MemoryInput[] = [];
  const prov = migrationProvenance("lessons.jsonl");
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const severity: MemorySeverity =
      typeof r.severity === "string" &&
      ["low", "medium", "high", "critical"].includes(r.severity)
        ? (r.severity as MemorySeverity)
        : "low";
    const files = Array.isArray(r.files)
      ? (r.files.filter((f) => typeof f === "string") as string[])
      : [];

    // Simple lesson: { type, lesson, severity, files }
    if (typeof r.lesson === "string" && r.lesson.trim()) {
      out.push({
        projectId,
        kind:
          r.type === "bootstrap" ? "project_fact" : classifyLesson(r.lesson),
        scope: files.length ? "file" : "project",
        text: r.lesson.trim(),
        severity,
        ...IMPORTED,
        files,
        provenance: prov,
      });
    }

    // Compound trace-diagnosis: { patterns[], lessons[], improvements[] }
    if (Array.isArray(r.patterns)) {
      for (const p of r.patterns) {
        if (typeof p === "string" && p.trim()) {
          out.push({
            projectId,
            kind: "failure_pattern",
            scope: "project",
            text: p.trim(),
            severity,
            ...IMPORTED,
            provenance: prov,
          });
        }
      }
    }
    if (Array.isArray(r.lessons)) {
      for (const l of r.lessons) {
        if (typeof l === "string" && l.trim()) {
          out.push({
            projectId,
            kind: classifyLesson(l),
            scope: "project",
            text: l.trim(),
            severity,
            ...IMPORTED,
            provenance: prov,
          });
        }
      }
    }
  }
  return out;
}

/** conventions.json patterns/namingConventions -> convention memories. */
export function conventionsToMemories(
  data: unknown,
  projectId: string,
): MemoryInput[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const out: MemoryInput[] = [];
  const prov = migrationProvenance("conventions.json");
  for (const group of ["patterns", "namingConventions"]) {
    const entries = d[group];
    if (!entries || typeof entries !== "object") continue;
    for (const [key, value] of Object.entries(entries as object)) {
      const detail = typeof value === "string" ? value : JSON.stringify(value);
      out.push({
        projectId,
        kind: "convention",
        scope: "project",
        text: `${key}: ${detail}`,
        severity: "low",
        ...IMPORTED,
        provenance: prov,
      });
    }
  }
  return out;
}

/** file-insights.json insights -> file-scoped project_fact memories. */
export function fileInsightsToMemories(
  data: unknown,
  projectId: string,
): MemoryInput[] {
  if (!data || typeof data !== "object") return [];
  const insights = (data as Record<string, unknown>).insights;
  if (!insights || typeof insights !== "object") return [];
  const out: MemoryInput[] = [];
  const prov = migrationProvenance("file-insights.json");
  for (const [filePath, raw] of Object.entries(insights as object)) {
    if (!raw || typeof raw !== "object") continue;
    const insight = raw as Record<string, unknown>;
    const role = typeof insight.role === "string" ? insight.role : "";
    const notes = Array.isArray(insight.notes)
      ? insight.notes.filter((n) => typeof n === "string")
      : [];
    const text = [role, ...notes].filter(Boolean).join(" — ").trim();
    if (!text) continue;
    out.push({
      projectId,
      kind: "project_fact",
      scope: "file",
      text,
      severity: riskToSeverity(insight.risk),
      ...IMPORTED,
      files: [filePath],
      provenance: prov,
    });
  }
  return out;
}

/** user-prefs.json preferences -> user_preference memories. */
export function userPrefsToMemories(
  data: unknown,
  projectId: string,
): MemoryInput[] {
  if (!data || typeof data !== "object") return [];
  const prefs = (data as Record<string, unknown>).preferences;
  if (!prefs || typeof prefs !== "object") return [];
  const out: MemoryInput[] = [];
  const prov = migrationProvenance("user-prefs.json");
  for (const [category, value] of Object.entries(prefs as object)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) {
          out.push({
            projectId,
            kind: "user_preference",
            scope: "global",
            text: item.trim(),
            severity: "low",
            ...IMPORTED,
            provenance: prov,
          });
        }
      }
    } else if (
      value &&
      typeof value === "object" &&
      Object.keys(value).length
    ) {
      out.push({
        projectId,
        kind: "user_preference",
        scope: "global",
        text: `${category}: ${JSON.stringify(value)}`,
        severity: "low",
        ...IMPORTED,
        provenance: prov,
      });
    }
  }
  return out;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function readJsonl(file: string): unknown[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  const out: unknown[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip corrupt line
    }
  }
  return out;
}

/**
 * Read all four brain files from `brainDir` and return the combined typed
 * memories ready for `appendMemory`. Missing/corrupt files contribute nothing.
 */
export function collectBrainMigrations(
  brainDir: string,
  projectId: string,
): MemoryInput[] {
  return [
    ...lessonsToMemories(
      readJsonl(path.join(brainDir, "lessons.jsonl")),
      projectId,
    ),
    ...conventionsToMemories(
      readJson(path.join(brainDir, "conventions.json")),
      projectId,
    ),
    ...fileInsightsToMemories(
      readJson(path.join(brainDir, "file-insights.json")),
      projectId,
    ),
    ...userPrefsToMemories(
      readJson(path.join(brainDir, "user-prefs.json")),
      projectId,
    ),
  ];
}
