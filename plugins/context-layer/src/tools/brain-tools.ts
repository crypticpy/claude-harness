/**
 * Brain Tools
 *
 * MCP tools for Claude to interact with its persistent brain:
 * - brain_search: Search lessons, insights, conventions
 * - mistake_log: Log mistakes for future learning
 * - session_summary: Save session accomplishments as lessons
 */

import * as fs from "fs";
import * as path from "path";
import { recordMemoryRecall } from "../storage/recall-ledger";

// =============================================================================
// Types
// =============================================================================

interface Lesson {
  timestamp: string;
  type: string;
  lesson: string;
  severity: string;
  files?: string[];
}

interface FileInsight {
  role: string;
  risk: string;
  dependents?: number;
  notes: string[];
}

interface HotFile {
  path: string;
  accessCount: number;
  lastAccessed: string | null;
  reason: string;
  intelligence?: {
    summary: string;
    exports: string[];
    imports: string[];
    complexity: string;
    lineCount: number;
    dependents?: number;
  };
}

interface SearchResult {
  source: "lesson" | "file-insight" | "convention" | "hot-file" | "memory";
  match: string;
  context: string;
  relevance: number;
  id?: string; // typed-memory id (mem_*) — set only for source "memory"
}

interface Memory {
  id?: string;
  kind: string;
  scope?: string;
  text: string;
  severity?: string;
  files?: string[];
  symbols?: string[];
  status?: string;
  expiresAt?: string;
}

// =============================================================================
// Brain Directory Helpers
// =============================================================================

function getBrainDir(projectPath: string): string {
  return path.join(projectPath, ".claude", "context-layer");
}

function ensureBrainDir(projectPath: string): void {
  const dir = getBrainDir(projectPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// =============================================================================
// brain_search
// =============================================================================

export interface BrainSearchInput {
  query: string;
  projectPath: string;
  sources?: (
    "lessons" | "file-insights" | "conventions" | "hot-files" | "memories"
  )[];
}

export interface BrainSearchResult {
  query: string;
  results: SearchResult[];
  totalMatches: number;
}

export async function brainSearch(
  input: BrainSearchInput,
): Promise<BrainSearchResult> {
  const { query, projectPath, sources } = input;
  const brainDir = getBrainDir(projectPath);
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2);

  // Search lessons
  if (!sources || sources.includes("lessons")) {
    const lessonsPath = path.join(brainDir, "lessons.jsonl");
    if (fs.existsSync(lessonsPath)) {
      try {
        // Parse per line and skip corrupt rows — a single half-written append
        // (e.g. a crash mid-flush by the PreCompact lesson writer) must not drop
        // every other lesson from recall. Mirrors the memories-source handling.
        const lessons = fs
          .readFileSync(lessonsPath, "utf-8")
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => {
            try {
              return JSON.parse(line) as Lesson;
            } catch {
              return null;
            }
          })
          .filter((l): l is Lesson => l !== null);

        for (const lesson of lessons) {
          const text =
            `${lesson.type} ${lesson.lesson} ${(lesson.files || []).join(" ")}`.toLowerCase();
          const relevance = calculateRelevance(text, queryTerms);
          if (relevance > 0) {
            results.push({
              source: "lesson",
              match: lesson.lesson,
              context: `[${lesson.severity}] ${lesson.type}: ${lesson.lesson}`,
              relevance,
            });
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Search file insights
  if (!sources || sources.includes("file-insights")) {
    const insightsPath = path.join(brainDir, "file-insights.json");
    if (fs.existsSync(insightsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(insightsPath, "utf-8"));
        const insights = data.insights as Record<string, FileInsight>;

        for (const [filePath, insight] of Object.entries(insights)) {
          const text =
            `${filePath} ${insight.role} ${insight.risk} ${insight.notes.join(" ")}`.toLowerCase();
          const relevance = calculateRelevance(text, queryTerms);
          if (relevance > 0) {
            results.push({
              source: "file-insight",
              match: filePath,
              context: `${filePath}: ${insight.role} (risk: ${insight.risk})`,
              relevance,
            });
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Search conventions
  if (!sources || sources.includes("conventions")) {
    const conventionsPath = path.join(brainDir, "conventions.json");
    if (fs.existsSync(conventionsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(conventionsPath, "utf-8"));
        const patterns = data.patterns as Record<
          string,
          { location: string; description: string }
        >;

        for (const [name, pattern] of Object.entries(patterns)) {
          const text =
            `${name} ${pattern.location} ${pattern.description}`.toLowerCase();
          const relevance = calculateRelevance(text, queryTerms);
          if (relevance > 0) {
            results.push({
              source: "convention",
              match: name,
              context: `${name}: ${pattern.description} (${pattern.location})`,
              relevance,
            });
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Search hot files
  if (!sources || sources.includes("hot-files")) {
    const hotFilesPath = path.join(brainDir, "hot-files.json");
    if (fs.existsSync(hotFilesPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(hotFilesPath, "utf-8"));
        const hotFiles = data.hotFiles as HotFile[];

        for (const hf of hotFiles) {
          const intel = hf.intelligence;
          const text =
            `${hf.path} ${hf.reason} ${intel?.summary || ""} ${intel?.exports?.join(" ") || ""}`.toLowerCase();
          const relevance = calculateRelevance(text, queryTerms);
          if (relevance > 0) {
            results.push({
              source: "hot-file",
              match: hf.path,
              context: intel?.summary
                ? `${hf.path}: ${intel.summary.split("\n")[0]}`
                : `${hf.path}: ${hf.reason}`,
              relevance,
            });
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Search typed memories (memory_write + auto-distill). Active, non-expired only.
  if (!sources || sources.includes("memories")) {
    const memoriesPath = path.join(brainDir, "memories.jsonl");
    if (fs.existsSync(memoriesPath)) {
      try {
        const now = Date.now();
        const memories = fs
          .readFileSync(memoriesPath, "utf-8")
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => {
            try {
              return JSON.parse(line) as Memory;
            } catch {
              return null;
            }
          })
          .filter((m): m is Memory => {
            if (m === null) return false;
            if (m.status !== undefined && m.status !== "active") return false;
            if (m.expiresAt) {
              const exp = Date.parse(m.expiresAt);
              // Malformed expiry is corrupt — exclude (fail-safe), matching the
              // store's prune + puntax_context recall. Otherwise NaN <= now is
              // false and an expired row leaks until the next prune sweep.
              if (Number.isNaN(exp) || exp <= now) return false;
            }
            return true;
          });

        for (const mem of memories) {
          const text =
            `${mem.kind} ${mem.text} ${(mem.files || []).join(" ")}`.toLowerCase();
          const relevance = calculateRelevance(text, queryTerms);
          if (relevance > 0) {
            results.push({
              source: "memory",
              match: mem.text.slice(0, 80),
              context: `[${mem.kind}/${mem.severity || "info"}] ${mem.text}`,
              relevance,
              id: mem.id,
            });
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Sort by relevance
  results.sort((a, b) => b.relevance - a.relevance);
  const top = results.slice(0, 10); // Top 10

  // Recall telemetry: only what was actually returned counts as recalled.
  recordMemoryRecall(
    projectPath,
    top.filter((r) => r.source === "memory").map((r) => r.id),
    { via: "brain_search" },
  );

  return {
    query,
    results: top,
    totalMatches: results.length,
  };
}

function calculateRelevance(text: string, queryTerms: string[]): number {
  let score = 0;
  for (const term of queryTerms) {
    if (text.includes(term)) {
      score += 1;
      // Bonus for exact word match
      if (new RegExp(`\\b${term}\\b`).test(text)) {
        score += 0.5;
      }
    }
  }
  return score;
}

// =============================================================================
// mistake_log
// =============================================================================

export interface MistakeLogInput {
  mistake: string;
  projectPath: string;
  severity?: "low" | "medium" | "high";
  files?: string[];
}

export interface MistakeLogResult {
  logged: boolean;
  lessonCount: number;
}

export async function mistakeLog(
  input: MistakeLogInput,
): Promise<MistakeLogResult> {
  const { mistake, projectPath, severity = "medium", files = [] } = input;
  const brainDir = getBrainDir(projectPath);
  ensureBrainDir(projectPath);

  const lessonsPath = path.join(brainDir, "lessons.jsonl");

  const lesson: Lesson = {
    timestamp: new Date().toISOString(),
    type: "mistake",
    lesson: `DON'T: ${mistake}`,
    severity,
    files,
  };

  try {
    fs.appendFileSync(lessonsPath, JSON.stringify(lesson) + "\n");

    // Count total lessons
    const content = fs.readFileSync(lessonsPath, "utf-8");
    const lessonCount = content.split("\n").filter((l) => l.trim()).length;

    return { logged: true, lessonCount };
  } catch {
    return { logged: false, lessonCount: 0 };
  }
}

// =============================================================================
// session_summary
// =============================================================================

export interface SessionSummaryInput {
  summary: string;
  projectPath: string;
  accomplishments?: string[];
  lessonsLearned?: string[];
}

export interface SessionSummaryResult {
  saved: boolean;
  lessonsAdded: number;
}

export async function sessionSummary(
  input: SessionSummaryInput,
): Promise<SessionSummaryResult> {
  const {
    summary,
    projectPath,
    accomplishments: _accomplishments = [],
    lessonsLearned = [],
  } = input;
  // Note: accomplishments are included in summary text, individual lessons come from lessonsLearned
  const brainDir = getBrainDir(projectPath);
  ensureBrainDir(projectPath);

  const lessonsPath = path.join(brainDir, "lessons.jsonl");
  let lessonsAdded = 0;

  try {
    // Add main summary as a lesson
    const mainLesson: Lesson = {
      timestamp: new Date().toISOString(),
      type: "session-summary",
      lesson: summary,
      severity: "medium",
    };
    fs.appendFileSync(lessonsPath, JSON.stringify(mainLesson) + "\n");
    lessonsAdded++;

    // Add individual lessons learned
    for (const lesson of lessonsLearned) {
      const lessonEntry: Lesson = {
        timestamp: new Date().toISOString(),
        type: "discovery",
        lesson,
        severity: "medium",
      };
      fs.appendFileSync(lessonsPath, JSON.stringify(lessonEntry) + "\n");
      lessonsAdded++;
    }

    return { saved: true, lessonsAdded };
  } catch {
    return { saved: false, lessonsAdded: 0 };
  }
}

// =============================================================================
// Tool Definitions for MCP
// =============================================================================

export const brainToolDefinitions = [
  {
    name: "brain_search",
    description:
      "Directly search your persistent brain (lessons, file insights, conventions, hot files, typed memories) with an explicit query — for recalling what you learned in previous sessions. Use this when you know what you're looking for; for task-scoped recall under a token budget, call puntax_context instead.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'Search query (e.g., "client.py", "authentication", "don\'t forget")',
        },
        projectDir: {
          type: "string",
          description: "Project root directory (defaults to cwd)",
        },
        sources: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "lessons",
              "file-insights",
              "conventions",
              "hot-files",
              "memories",
            ],
          },
          description: "Which sources to search (default: all)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "mistake_log",
    description:
      'Log a mistake you made so you remember not to do it again. Creates a "DON\'T" lesson in your brain.',
    inputSchema: {
      type: "object",
      properties: {
        mistake: {
          type: "string",
          description:
            'What you did wrong (e.g., "forgot to check file exists before editing")',
        },
        projectDir: {
          type: "string",
          description: "Project root directory (defaults to cwd)",
        },
        severity: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "How bad was it? (default: medium)",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Related files",
        },
      },
      required: ["mistake"],
    },
  },
  {
    name: "session_summary",
    description:
      "Save a summary of what you accomplished in this session. Creates lessons for future reference.",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            'What was accomplished (e.g., "Built auto-learn system with intelligence caching")',
        },
        projectDir: {
          type: "string",
          description: "Project root directory (defaults to cwd)",
        },
        accomplishments: {
          type: "array",
          items: { type: "string" },
          description: "List of specific things completed",
        },
        lessonsLearned: {
          type: "array",
          items: { type: "string" },
          description: "Lessons discovered during the session",
        },
      },
      required: ["summary"],
    },
  },
];
