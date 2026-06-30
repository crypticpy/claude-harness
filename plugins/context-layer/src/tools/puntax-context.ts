/**
 * puntax_context (v0)
 *
 * The PUNTAX v2 primary tool: return the smallest relevant context block for the
 * current task, mode, and token budget — replacing broad always-on injection.
 *
 * v0 sources are the existing brain files (lessons, file-insights, conventions,
 * hot-files, user-prefs). Event-ledger / checkpoint / code-map sources arrive in
 * later phases. Ranking + budget packing live in the pure ./context/ranker.
 */

import * as fs from "fs";
import * as path from "path";
import {
  rankCandidates,
  type RankCandidate,
  type SourceKind,
} from "../context/ranker";
import { loadPuntaxConfig, type PuntaxConfig } from "../config/puntax-config";

// =============================================================================
// Contract (docs/08)
// =============================================================================

export type PuntaxMode =
  "prompt" | "pre_edit" | "resume" | "debug" | "review" | "architecture";

export interface PuntaxContextInput {
  task: string;
  projectDir?: string;
  sessionId?: string;
  mode?: PuntaxMode;
  files?: string[];
  symbols?: string[];
  budgetTokens?: number;
}

export interface PuntaxSource {
  kind: SourceKind;
  id?: string;
  path?: string;
  line?: number;
  confidence?: string;
}

export interface PuntaxContextOutput {
  context: string;
  sources: PuntaxSource[];
  nextTools: string[];
  confidence: "high" | "medium" | "low";
  omitted?: { reason: string; count?: number };
}

// =============================================================================
// Mode defaults
// =============================================================================

const MODE_BUDGET_FALLBACK: Record<PuntaxMode, number> = {
  prompt: 300,
  pre_edit: 1200,
  resume: 1500,
  debug: 2000,
  review: 3000,
  architecture: 3000,
};

const MODE_NEXT_TOOLS: Record<PuntaxMode, string[]> = {
  prompt: ["brain_search"],
  pre_edit: ["impact_check", "symbol_context"],
  resume: ["what_changed", "brain_search"],
  debug: ["what_changed", "brain_search"],
  review: ["impact_check", "semantic_lookup"],
  architecture: ["semantic_lookup", "impact_check"],
};

// =============================================================================
// Brain-file readers (mirror brain-tools getBrainDir semantics)
// =============================================================================

function brainDir(projectDir: string): string {
  return path.join(projectDir, ".claude", "context-layer");
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

interface RawLesson {
  timestamp?: string;
  type?: string;
  lesson?: string;
  lessons?: string[];
  patterns?: string[];
  severity?: string;
  files?: string[];
}

function readLessons(dir: string): RawLesson[] {
  const file = path.join(dir, "lessons.jsonl");
  try {
    return fs
      .readFileSync(file, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as RawLesson;
        } catch {
          return null;
        }
      })
      .filter((l): l is RawLesson => l !== null);
  } catch {
    return [];
  }
}

interface RawMemory {
  id?: string;
  kind?: string;
  scope?: string;
  text?: string;
  files?: string[];
  symbols?: string[];
  severity?: string;
  createdAt?: string;
  status?: string;
  expiresAt?: string;
}

// Typed memories (memory_write + auto-distill). Active, non-expired only —
// mirrors structured-context.mjs's status filter so write and recall agree.
function readMemories(dir: string, now: number): RawMemory[] {
  const file = path.join(dir, "memories.jsonl");
  try {
    return fs
      .readFileSync(file, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as RawMemory;
        } catch {
          return null;
        }
      })
      .filter((m): m is RawMemory => {
        if (!m || typeof m.text !== "string" || !m.text) return false;
        if (m.status !== undefined && m.status !== "active") return false;
        if (m.expiresAt) {
          const exp = Date.parse(m.expiresAt);
          // Malformed expiry is corrupt — exclude (fail-safe), matching prune.
          if (Number.isNaN(exp) || exp <= now) return false;
        }
        return true;
      });
  } catch {
    return [];
  }
}

// =============================================================================
// Keyword relevance (mirrors brain-tools calculateRelevance)
// =============================================================================

function keywordScore(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) {
      score += 1;
      if (new RegExp(`\\b${escapeRegExp(term)}\\b`).test(lower)) score += 0.5;
    }
  }
  return score;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryTerms(input: PuntaxContextInput): string[] {
  const parts = [
    input.task || "",
    ...(input.files || []).map((f) => path.basename(f)),
    ...(input.symbols || []),
  ];
  return parts
    .join(" ")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function fileMatches(
  candidatePath: string | undefined,
  files?: string[],
): boolean {
  if (!candidatePath || !files || files.length === 0) return false;
  const base = path.basename(candidatePath);
  return files.some(
    (f) =>
      f === candidatePath ||
      path.basename(f) === base ||
      candidatePath.endsWith(f),
  );
}

function riskToSeverity(risk?: string): string | undefined {
  const r = (risk || "").toLowerCase();
  if (r.includes("high") || r.includes("critical")) return "high";
  if (r.includes("med")) return "medium";
  if (r.includes("low")) return "low";
  return undefined;
}

// =============================================================================
// Candidate construction
// =============================================================================

// Kind bias for recall ranking: durable, hard-won knowledge (why a decision was
// made, what keeps breaking) should surface before routine observations (which
// test command was run). Tunable; unknown kinds are neutral (0).
const MEMORY_KIND_WEIGHT: Record<string, number> = {
  decision: 2,
  failure_pattern: 1.5,
  gotcha: 1,
  api_contract: 1,
  user_preference: 1,
  convention: 0.5,
  project_fact: 0.5,
  test_command: -0.5,
};

function memoryKindWeight(kind?: string): number {
  return MEMORY_KIND_WEIGHT[(kind || "").toLowerCase()] ?? 0;
}

function buildCandidates(
  projectDir: string,
  input: PuntaxContextInput,
  now: number,
): RankCandidate[] {
  const dir = brainDir(projectDir);
  const terms = queryTerms(input);
  const symbols = (input.symbols || []).map((s) => s.toLowerCase());
  const candidates: RankCandidate[] = [];

  // Lessons → memory candidates
  for (const lesson of readLessons(dir)) {
    const body =
      lesson.lesson ||
      [...(lesson.lessons || []), ...(lesson.patterns || [])].join("; ");
    if (!body) continue;
    const text = `[${lesson.severity || "info"}] ${lesson.type || "lesson"}: ${body}`;
    candidates.push({
      kind: "memory",
      text,
      severity: lesson.severity,
      timestamp: lesson.timestamp,
      keywordScore: keywordScore(text, terms),
      fileMatch: (lesson.files || []).some((f) => fileMatches(f, input.files)),
    });
  }

  // Typed memories (memory_write + auto-distill) → memory candidates
  for (const mem of readMemories(dir, now)) {
    const text = `[${mem.kind || "memory"}/${mem.severity || "info"}] ${mem.text}`;
    candidates.push({
      kind: "memory",
      id: mem.id,
      text,
      severity: mem.severity,
      timestamp: mem.createdAt,
      keywordScore: keywordScore(text, terms),
      kindWeight: memoryKindWeight(mem.kind),
      fileMatch: (mem.files || []).some((f) => fileMatches(f, input.files)),
      symbolMatch: (mem.symbols || []).some((s) =>
        symbols.includes(s.toLowerCase()),
      ),
    });
  }

  // File insights → file candidates
  const insightsData = readJson<{
    insights?: Record<
      string,
      { role?: string; risk?: string; notes?: string[]; dependents?: number }
    >;
  }>(path.join(dir, "file-insights.json"));
  for (const [filePath, insight] of Object.entries(
    insightsData?.insights || {},
  )) {
    const notes = (insight.notes || []).join("; ");
    const text = `${filePath}: ${insight.role || "file"} (risk: ${insight.risk || "unknown"})${notes ? ` — ${notes}` : ""}`;
    candidates.push({
      kind: "file",
      path: filePath,
      text,
      severity: riskToSeverity(insight.risk),
      keywordScore: keywordScore(text, terms),
      fileMatch: fileMatches(filePath, input.files),
    });
  }

  // Conventions → memory candidates
  const conventionsData = readJson<{
    patterns?: Record<string, { location?: string; description?: string }>;
  }>(path.join(dir, "conventions.json"));
  for (const [name, pattern] of Object.entries(
    conventionsData?.patterns || {},
  )) {
    const text = `${name}: ${pattern.description || ""}${pattern.location ? ` (${pattern.location})` : ""}`;
    candidates.push({
      kind: "memory",
      id: name,
      text,
      keywordScore: keywordScore(text, terms),
    });
  }

  // Hot files → file candidates
  const hotData = readJson<{
    hotFiles?: Array<{
      path: string;
      accessCount?: number;
      reason?: string;
      intelligence?: { summary?: string; exports?: string[] };
    }>;
  }>(path.join(dir, "hot-files.json"));
  for (const hf of hotData?.hotFiles || []) {
    const intel = hf.intelligence;
    const summary = intel?.summary
      ? intel.summary.split("\n")[0]
      : hf.reason || "";
    const text = `${hf.path}: ${summary}`;
    candidates.push({
      kind: "file",
      path: hf.path,
      text,
      // Normalize access count into the ranker's clamped [0,3] hot weight.
      hotFileScore: Math.min((hf.accessCount || 0) / 5, 3),
      keywordScore:
        keywordScore(text, terms) +
        (intel?.exports || []).reduce(
          (n, ex) => n + (symbols.includes(ex.toLowerCase()) ? 2 : 0),
          0,
        ),
      fileMatch: fileMatches(hf.path, input.files),
      symbolMatch: (intel?.exports || []).some((ex) =>
        symbols.includes(ex.toLowerCase()),
      ),
    });
  }

  return candidates;
}

// =============================================================================
// Tool entry point
// =============================================================================

export async function puntaxContext(
  input: PuntaxContextInput,
  deps: { config?: PuntaxConfig; now?: number } = {},
): Promise<PuntaxContextOutput> {
  const projectDir = input.projectDir || process.cwd();
  const mode: PuntaxMode = input.mode || "prompt";
  const config = deps.config || loadPuntaxConfig();
  const now = deps.now ?? Date.now();

  // Rollback switch: PUNTAX_CONTEXT_ROUTER=false / config disabled → no-op.
  if (!config.contextRouter.enabled) {
    return {
      context: "",
      sources: [],
      nextTools: MODE_NEXT_TOOLS[mode],
      confidence: "low",
      omitted: { reason: "context router disabled" },
    };
  }

  const budget =
    input.budgetTokens ??
    config.contextRouter.budgets[mode] ??
    MODE_BUDGET_FALLBACK[mode];

  const candidates = buildCandidates(projectDir, input, now);
  const { selected, omitted } = rankCandidates(candidates, {
    budgetTokens: budget,
    now,
    maxItems: 12,
  });

  const sources: PuntaxSource[] = selected.map((s) => ({
    kind: s.kind,
    id: s.id,
    path: s.path,
    line: s.line,
    confidence: typeof s.confidence === "string" ? s.confidence : undefined,
  }));

  const context = selected.map((s) => `• ${s.text}`).join("\n");

  // Confidence: an explicit file/symbol match in the top item is "high";
  // any selection is "medium"; nothing relevant is "low".
  let confidence: "high" | "medium" | "low" = "low";
  if (selected.length > 0) {
    confidence =
      selected[0].fileMatch || selected[0].symbolMatch ? "high" : "medium";
  }

  const output: PuntaxContextOutput = {
    context,
    sources,
    nextTools: MODE_NEXT_TOOLS[mode],
    confidence,
  };
  if (omitted > 0) {
    output.omitted = { reason: "budget or relevance", count: omitted };
  }
  return output;
}

// =============================================================================
// MCP tool definition
// =============================================================================

export const puntaxContextToolDefinition = {
  name: "puntax_context",
  description:
    "Return the smallest relevant context block for the current task under a token budget. The PUNTAX primary tool — call before reaching for broad recall. Modes: prompt|pre_edit|resume|debug|review|architecture.",
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "What you are about to do (used for relevance ranking)",
      },
      mode: {
        type: "string",
        enum: [
          "prompt",
          "pre_edit",
          "resume",
          "debug",
          "review",
          "architecture",
        ],
        description:
          "Context mode; sets the token budget and which sources matter",
      },
      files: {
        type: "array",
        items: { type: "string" },
        description: "Files in play (boosts matching memory/insights)",
      },
      symbols: {
        type: "array",
        items: { type: "string" },
        description: "Symbols in play (boosts matching exports)",
      },
      budgetTokens: {
        type: "number",
        description: "Override the mode default token budget",
      },
      projectDir: {
        type: "string",
        description: "Project root directory (defaults to cwd)",
      },
    },
    required: ["task"],
  },
};
