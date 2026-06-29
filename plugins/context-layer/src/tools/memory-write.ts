/**
 * memory_write — write a typed, provenance-tagged memory to the project-local
 * memories.jsonl (schemas/memory.schema.json).
 *
 * The caller supplies kind/scope/text/severity/confidence/provenance; the
 * projectId is derived from the project root so callers never hand-compute it.
 * Invalid input is rejected (never written) and exact duplicates collapse — so
 * an agent or the distiller cannot poison memory by repetition.
 */

import * as path from "path";

import { projectIdFor } from "../storage/code-map";
import {
  appendMemory,
  type MemoryKind,
  type MemoryScope,
  type MemorySeverity,
  type MemoryConfidence,
  type ProvenanceSource,
} from "../storage/memory-store";

export interface MemoryWriteInput {
  kind: MemoryKind;
  scope: MemoryScope;
  text: string;
  severity?: MemorySeverity;
  confidence?: MemoryConfidence;
  source?: ProvenanceSource;
  files?: string[];
  symbols?: string[];
  eventIds?: string[];
  sourcePath?: string | null;
  notes?: string | null;
  expiresAt?: string | null;
  projectPath?: string;
}

export interface MemoryWriteResult {
  written: boolean;
  id: string;
  reason?: "duplicate" | "invalid";
  errors?: string[];
}

export function memoryWrite(input: MemoryWriteInput): MemoryWriteResult {
  const projectDir = path.resolve(input.projectPath ?? process.cwd());
  const projectId = projectIdFor(projectDir);

  return appendMemory(projectDir, {
    projectId,
    kind: input.kind,
    scope: input.scope,
    text: input.text,
    severity: input.severity ?? "medium",
    confidence: input.confidence ?? "user_confirmed",
    files: input.files,
    symbols: input.symbols,
    expiresAt: input.expiresAt,
    provenance: {
      source: input.source ?? "user",
      ...(input.eventIds ? { eventIds: input.eventIds } : {}),
      ...(input.sourcePath !== undefined
        ? { sourcePath: input.sourcePath }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
}

export const memoryWriteToolDefinition = {
  name: "memory_write",
  description:
    "Write a typed, provenance-tagged memory to the project's memories.jsonl. Use for durable facts worth recalling later: decisions, gotchas, conventions, api_contracts, test_commands, failure_patterns, user_preferences, project_facts. Invalid input is rejected and exact duplicates are deduped. projectId is derived from projectPath.",
  inputSchema: {
    type: "object",
    required: ["kind", "scope", "text"],
    properties: {
      kind: {
        type: "string",
        enum: [
          "decision",
          "gotcha",
          "convention",
          "api_contract",
          "test_command",
          "failure_pattern",
          "user_preference",
          "project_fact",
          "permission_rule_candidate",
        ],
        description: "Memory category",
      },
      scope: {
        type: "string",
        enum: ["global", "project", "repo", "file", "symbol"],
        description: "Breadth this memory applies to",
      },
      text: {
        type: "string",
        description: "The memory content (1–4000 chars)",
      },
      severity: {
        type: "string",
        enum: ["low", "medium", "high", "critical"],
        description: "How important — defaults to medium",
      },
      confidence: {
        type: "string",
        enum: [
          "observed",
          "user_confirmed",
          "inferred",
          "llm_distilled",
          "imported",
        ],
        description: "How trustworthy — defaults to user_confirmed",
      },
      source: {
        type: "string",
        enum: [
          "user",
          "event",
          "test_failure",
          "diagnostic",
          "source",
          "llm",
          "migration",
          "manual",
        ],
        description: "Provenance source — defaults to user",
      },
      files: {
        type: "array",
        items: { type: "string" },
        description: "Repo-relative files this memory concerns",
      },
      symbols: {
        type: "array",
        items: { type: "string" },
        description: "Symbols this memory concerns",
      },
      sourcePath: {
        type: "string",
        description: "Originating file/path for provenance",
      },
      notes: {
        type: "string",
        description: "Free-text provenance notes",
      },
      projectPath: {
        type: "string",
        description: "Project root (defaults to cwd)",
      },
    },
  },
};
