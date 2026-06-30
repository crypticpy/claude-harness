/**
 * Project Personality Hook
 *
 * Runs on UserPromptSubmit to inject project context into Claude's context.
 * Extracts stack, patterns, conventions, and gotchas from project configuration files.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type {
  ProjectPersonality,
  StackInfo,
  Pattern,
  Gotcha,
  KeyFile,
  ExtractionOptions,
  ProjectType,
  MLStackInfo,
  MonorepoType,
} from "../personality/types";
// AudioDspInfo is used via StackInfo.audioDsp property type
import { createStorage, computeProjectHash } from "../storage";
import type { ContextStorage, ProjectProfile } from "../storage";

// =============================================================================
// Hook Interface Types
// =============================================================================

export interface HookInput {
  session_id: string;
  prompt: string;
}

export interface HookOutput {
  continue: boolean;
  result?: string;
}

// =============================================================================
// Configuration
// =============================================================================

const CONFIG_FILES = [
  "package.json",
  "tsconfig.json",
  "Cargo.toml",
  "pyproject.toml",
  "CLAUDE.md",
  ".clauderc",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "Gemfile",
  "composer.json",
  "requirements.txt",
  "setup.py",
] as const;

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_MARKER_FILE = ".claude/context-layer/.last-session";

// =============================================================================
// Persistent Brain Types
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
  autoLearned?: boolean;
  intelligence?: {
    summary: string;
    exports: string[];
    imports: string[];
    complexity: string;
    lineCount: number;
    dependents?: number;
    cachedAt: number;
  };
}

interface PersistentBrain {
  lessons: Lesson[];
  conventions: Record<string, { location: string; description: string }>;
  fileInsights: Record<string, FileInsight>;
  hotFiles: HotFile[];
  userQuirks: string[];
}

interface TokenStats {
  timestamp: number;
  context_size: number;
  current_tokens: number;
  current_k: number;
  percent_used: number;
  model: string;
  session_cost_usd: number;
  session_id?: string;
}

// =============================================================================
// Token Stats Reader
// =============================================================================

const TOKEN_STATS_FILE = "/tmp/claude-context-stats.json";

// The stats file is a single GLOBAL /tmp file shared by every session and
// rewritten by statusline-command.sh on each render. A new session's first
// UserPromptSubmit (when personality is injected) can fire BEFORE this
// session's statusline has rendered, so the file may still hold the PREVIOUS
// session's final token count — which is how a fresh session once reported
// "238K/256K (93%)". Past this age with no session match, we treat stats as
// stale rather than trust them.
const TOKEN_STATS_MAX_AGE_MS = 2 * 60 * 1000; // 2 minutes

// Auto-compact trigger = CLAUDE_CODE_AUTO_COMPACT_WINDOW * 0.80.
// Empirically Claude Code fires auto-compact near 80% of the window; the
// CLAUDE_AUTOCOMPACT_PCT_OVERRIDE env var is documented but unreliable on
// the main thread (anthropics/claude-code#36381), so we don't trust it.
const COMPACTION_THRESHOLD: number = (() => {
  const window = parseInt(
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW || "200000",
    10,
  );
  return Math.floor(window * 0.8);
})();

/**
 * Decide whether a token-stats snapshot is provably from the current, live
 * session. Pure (no I/O) so it can be unit-tested with a fixed clock.
 *
 * - If both the snapshot and the caller carry a session_id, an exact match is
 *   authoritative (and a mismatch is rejected outright — this is the guard that
 *   stops a fresh session inheriting the prior session's token count).
 * - Otherwise (legacy snapshots written before the statusline stamped a
 *   session_id) fall back to a wall-clock freshness window.
 */
export function isTokenStatsFresh(
  stats: Pick<TokenStats, "timestamp" | "session_id">,
  currentSessionId: string | undefined,
  nowMs: number,
): boolean {
  if (stats.session_id && currentSessionId) {
    return stats.session_id === currentSessionId;
  }
  // timestamp is Unix SECONDS (written via `date +%s`); nowMs is milliseconds.
  if (typeof stats.timestamp !== "number") {
    return false;
  }
  const ageMs = nowMs - stats.timestamp * 1000;
  return Number.isFinite(ageMs) && ageMs <= TOKEN_STATS_MAX_AGE_MS;
}

function loadTokenStats(currentSessionId?: string): TokenStats | null {
  try {
    if (fs.existsSync(TOKEN_STATS_FILE)) {
      const content = fs.readFileSync(TOKEN_STATS_FILE, "utf-8");
      const stats = JSON.parse(content) as TokenStats;
      if (!isTokenStatsFresh(stats, currentSessionId, Date.now())) {
        return null;
      }
      return stats;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function formatTokenAwareness(stats: TokenStats): string {
  // Calculate remaining until COMPACTION (154K), not total context (200K)
  const compactionK = Math.round(COMPACTION_THRESHOLD / 1000);
  const remainingUntilCompaction = COMPACTION_THRESHOLD - stats.current_tokens;
  const remainingK = Math.round(remainingUntilCompaction / 1000);

  // Percentage toward compaction threshold, not total context
  const percentTowardCompaction = Math.min(
    100,
    Math.round((stats.current_tokens / COMPACTION_THRESHOLD) * 100),
  );

  let statusEmoji = "🟢";
  let warning = "";

  if (remainingUntilCompaction <= 10000) {
    // <10K until compaction
    statusEmoji = "🔴";
    warning = " ⚠️ COMPACTION IMMINENT - save context!";
  } else if (remainingUntilCompaction <= 30000) {
    // <30K until compaction
    statusEmoji = "🟠";
    warning = " - consider saving key learnings";
  } else if (remainingUntilCompaction <= 50000) {
    // <50K until compaction
    statusEmoji = "🟡";
  }

  return `${statusEmoji} Context: ${stats.current_k}K/${compactionK}K (${percentTowardCompaction}%) | ~${remainingK}K until compaction${warning}`;
}

function checkAndTriggerPreCompactionSave(
  projectPath: string,
  sessionId?: string,
): string | null {
  const stats = loadTokenStats(sessionId);
  // Trigger warning when within 10K of compaction threshold
  const warningThreshold = COMPACTION_THRESHOLD - 10000;
  if (!stats || stats.current_tokens < warningThreshold) {
    return null;
  }

  // We're approaching compaction! Generate a save reminder
  const brainDir = path.join(projectPath, ".claude", "context-layer");
  const saveFile = path.join(brainDir, "pre-compaction-state.json");

  // Check if we already saved recently (within last 5 min)
  try {
    if (fs.existsSync(saveFile)) {
      const saved = JSON.parse(fs.readFileSync(saveFile, "utf-8"));
      if (Date.now() - saved.timestamp < 5 * 60 * 1000) {
        return null; // Already saved recently
      }
    }
  } catch {
    /* continue */
  }

  // Save current state marker
  const compactionK = Math.round(COMPACTION_THRESHOLD / 1000);
  const remainingK = Math.round(
    (COMPACTION_THRESHOLD - stats.current_tokens) / 1000,
  );
  const state = {
    timestamp: Date.now(),
    tokens_at_save: stats.current_tokens,
    remaining_until_compaction: COMPACTION_THRESHOLD - stats.current_tokens,
    session_cost: stats.session_cost_usd,
  };

  try {
    fs.mkdirSync(brainDir, { recursive: true });
    fs.writeFileSync(saveFile, JSON.stringify(state, null, 2));
  } catch {
    /* ignore */
  }

  return `
🚨 PRE-COMPACTION CHECKPOINT (${stats.current_k}K/${compactionK}K - ~${remainingK}K remaining)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Save anything important to your brain NOW:
• Add lessons to .claude/context-layer/lessons.jsonl
• Update hot-files.json with frequently accessed files
• Note any discoveries in file-insights.json

Compaction will happen soon. Your brain files will persist!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

// =============================================================================
// Persistent Brain Loader
// =============================================================================

// =============================================================================
// Auto-Bootstrap: Create brain on first run
// =============================================================================

function bootstrapBrain(projectPath: string): void {
  const brainDir = path.join(projectPath, ".claude", "context-layer");

  // Create directory structure
  fs.mkdirSync(brainDir, { recursive: true });

  // Detect stack info
  const stack = extractStackInfo(projectPath);
  const projectName = extractProjectName(projectPath);

  // Find key entry points and high-value files
  const keyFiles = identifyKeyFiles(projectPath);
  const patterns = extractPatterns(projectPath, 10);

  // Create initial lessons.jsonl
  const lessonsPath = path.join(brainDir, "lessons.jsonl");
  const initialLessons = [
    {
      timestamp: new Date().toISOString(),
      type: "bootstrap",
      lesson: `Project "${projectName}" initialized. Stack: ${[...stack.languages, ...stack.frameworks].join(", ") || "unknown"}`,
      severity: "low",
      files: [],
    },
  ];
  fs.writeFileSync(
    lessonsPath,
    initialLessons.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );

  // Create file-insights.json with key files
  const insightsPath = path.join(brainDir, "file-insights.json");
  const insights: Record<string, FileInsight> = {};
  for (const kf of keyFiles.slice(0, 10)) {
    insights[kf.path] = {
      role: kf.purpose,
      risk: kf.importance === "critical" ? "high" : "medium",
      notes: [`Identified as ${kf.importance} file`],
    };
  }
  fs.writeFileSync(
    insightsPath,
    JSON.stringify(
      { lastUpdated: new Date().toISOString(), insights },
      null,
      2,
    ),
  );

  // Create conventions.json with detected patterns
  const conventionsPath = path.join(brainDir, "conventions.json");
  const conventions: Record<string, { location: string; description: string }> =
    {};
  for (const p of patterns) {
    conventions[p.name] = {
      location: p.location || "",
      description: p.description || "",
    };
  }
  fs.writeFileSync(
    conventionsPath,
    JSON.stringify(
      {
        lastUpdated: new Date().toISOString(),
        patterns: conventions,
        namingConventions: {},
      },
      null,
      2,
    ),
  );

  // Create empty hot-files.json
  const hotFilesPath = path.join(brainDir, "hot-files.json");
  fs.writeFileSync(
    hotFilesPath,
    JSON.stringify(
      {
        lastUpdated: new Date().toISOString(),
        hotFiles: keyFiles.slice(0, 5).map((kf) => ({
          path: kf.path,
          accessCount: 0,
          lastAccessed: null,
          reason: kf.purpose,
        })),
      },
      null,
      2,
    ),
  );

  // Create user-prefs.json skeleton
  const prefsPath = path.join(brainDir, "user-prefs.json");
  fs.writeFileSync(
    prefsPath,
    JSON.stringify(
      {
        lastUpdated: new Date().toISOString(),
        preferences: {
          communicationStyle: {},
          codeStyle: {},
          workflow: {},
          quirks: [],
        },
      },
      null,
      2,
    ),
  );

  // Create .gitignore for session marker
  const gitignorePath = path.join(brainDir, ".gitignore");
  fs.writeFileSync(gitignorePath, ".last-session\n");
}

function loadPersistentBrain(projectPath: string): PersistentBrain | null {
  const brainDir = path.join(projectPath, ".claude", "context-layer");

  // AUTO-BOOTSTRAP: If no brain exists, create one!
  if (!fs.existsSync(brainDir)) {
    try {
      bootstrapBrain(projectPath);
    } catch (err) {
      // Bootstrap failed, fall back to dynamic detection
      if (process.env.DEBUG) {
        console.error("[PersonalityHook] Bootstrap failed:", err);
      }
      return null;
    }
  }

  const brain: PersistentBrain = {
    lessons: [],
    conventions: {},
    fileInsights: {},
    hotFiles: [],
    userQuirks: [],
  };

  // Load lessons (JSONL format)
  const lessonsPath = path.join(brainDir, "lessons.jsonl");
  if (fs.existsSync(lessonsPath)) {
    try {
      const content = fs.readFileSync(lessonsPath, "utf-8");
      brain.lessons = content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    } catch {
      /* ignore */
    }
  }

  // Load conventions
  const conventionsPath = path.join(brainDir, "conventions.json");
  if (fs.existsSync(conventionsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(conventionsPath, "utf-8"));
      brain.conventions = data.patterns || {};
    } catch {
      /* ignore */
    }
  }

  // Load file insights
  const insightsPath = path.join(brainDir, "file-insights.json");
  if (fs.existsSync(insightsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(insightsPath, "utf-8"));
      brain.fileInsights = data.insights || {};
    } catch {
      /* ignore */
    }
  }

  // Load hot files
  const hotFilesPath = path.join(brainDir, "hot-files.json");
  if (fs.existsSync(hotFilesPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(hotFilesPath, "utf-8"));
      brain.hotFiles = data.hotFiles || [];
    } catch {
      /* ignore */
    }
  }

  // Load user preferences/quirks
  const prefsPath = path.join(brainDir, "user-prefs.json");
  if (fs.existsSync(prefsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
      brain.userQuirks = data.preferences?.quirks || [];
    } catch {
      /* ignore */
    }
  }

  return brain;
}

function formatBrainContext(
  brain: PersistentBrain,
  projectPath: string,
  sessionId?: string,
): string {
  const lines: string[] = ["<project-personality>"];

  // Token awareness - show context usage
  const tokenStats = loadTokenStats(sessionId);
  if (tokenStats) {
    lines.push(formatTokenAwareness(tokenStats));
    lines.push("");
  }

  // Stack detection - tight summary (~50 tokens)
  const stack = extractStackInfo(projectPath);
  const summary = generateTightStackSummary(stack);
  if (summary) {
    lines.push(summary);
  }

  // Critical lessons (high severity only)
  const criticalLessons = brain.lessons
    .filter((l) => l.severity === "high")
    .slice(-3);
  if (criticalLessons.length > 0) {
    lines.push("");
    lines.push("Lessons learned:");
    for (const lesson of criticalLessons) {
      lines.push(`- ${lesson.lesson}`);
    }
  }

  // High-risk files
  const riskyFiles = Object.entries(brain.fileInsights)
    .filter(([_, insight]) => insight.risk === "high")
    .slice(0, 3);
  if (riskyFiles.length > 0) {
    lines.push("");
    lines.push("High-risk files:");
    for (const [filePath, insight] of riskyFiles) {
      const deps = insight.dependents ? ` (${insight.dependents} deps)` : "";
      lines.push(`- ${filePath}: ${insight.role}${deps}`);
    }
  }

  // Key patterns
  const patternEntries = Object.entries(brain.conventions).slice(0, 3);
  if (patternEntries.length > 0) {
    lines.push("");
    lines.push("Patterns:");
    for (const [name, pattern] of patternEntries) {
      lines.push(`- ${name}: ${pattern.location}`);
    }
  }

  // Hot files with pre-cached intelligence
  const hotFilesWithIntel = brain.hotFiles.filter((h) => h.intelligence);
  if (hotFilesWithIntel.length > 0) {
    lines.push("");
    lines.push("Hot files (auto-learned):");
    for (const hf of hotFilesWithIntel.slice(0, 5)) {
      const intel = hf.intelligence!;
      const deps = intel.dependents ? ` [${intel.dependents} deps]` : "";
      const exports =
        intel.exports.length > 0
          ? ` exports: ${intel.exports.slice(0, 3).join(", ")}`
          : "";
      lines.push(`- ${hf.path}${deps}: ${intel.summary.split("\n")[0]}`);
      if (exports) {
        lines.push(`  ${exports}`);
      }
    }
  }

  // User quirks
  if (brain.userQuirks.length > 0) {
    lines.push("");
    lines.push("User notes:");
    for (const quirk of brain.userQuirks.slice(0, 2)) {
      lines.push(`- ${quirk}`);
    }
  }

  lines.push("</project-personality>");
  return lines.join("\n");
}

// =============================================================================
// Session-Once Injection (only inject personality once per session)
// =============================================================================

function shouldInjectThisSession(
  projectPath: string,
  sessionId: string,
): boolean {
  const markerPath = path.join(projectPath, SESSION_MARKER_FILE);

  try {
    if (fs.existsSync(markerPath)) {
      const lastSession = fs.readFileSync(markerPath, "utf-8").trim();
      if (lastSession === sessionId) {
        // Already injected this session, skip
        return false;
      }
    }
  } catch {
    // If we can't read, assume we should inject
  }

  return true;
}

function markSessionInjected(projectPath: string, sessionId: string): void {
  const markerPath = path.join(projectPath, SESSION_MARKER_FILE);
  const markerDir = path.dirname(markerPath);

  try {
    if (!fs.existsSync(markerDir)) {
      fs.mkdirSync(markerDir, { recursive: true });
    }
    fs.writeFileSync(markerPath, sessionId);
  } catch {
    // Non-critical, ignore failures
  }
}

// =============================================================================
// Compaction Recovery
// =============================================================================

/**
 * Check for and retrieve compaction recovery context.
 * Returns recovery context string if we just recovered from compaction.
 */
function checkCompactionRecoveryContext(
  projectPath: string,
  sessionId: string,
): string | null {
  const PRE_COMPACTION_FILE = "pre-compaction-save.json";
  const COMPACTION_SAVE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  const savePath = path.join(
    projectPath,
    ".claude",
    "context-layer",
    PRE_COMPACTION_FILE,
  );

  if (!fs.existsSync(savePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(savePath, "utf-8");
    const save = JSON.parse(content) as {
      savedAt: string;
      sessionId: string;
      workingFiles: string[];
      workingSummary: string;
      sessionLessons: string[];
      detectedPatterns: string[];
    };

    // Check if save is recent enough
    const saveAge = Date.now() - new Date(save.savedAt).getTime();
    if (saveAge > COMPACTION_SAVE_TTL_MS) {
      // Too old, clean it up
      fs.unlinkSync(savePath);
      return null;
    }

    // Only recover if session IDs match or it's very recent
    const isVeryRecent = saveAge < 60 * 1000; // Less than 1 minute
    const sameSession = save.sessionId === sessionId;

    if (!isVeryRecent && !sameSession) {
      // Old or different session, clear it
      fs.unlinkSync(savePath);
      return null;
    }

    // Build recovery context
    const lines: string[] = [
      "<session-recovery>",
      "Context was recently compacted. Resuming from saved state:",
      "",
    ];

    if (save.workingSummary) {
      lines.push(`**What you were working on:**`);
      lines.push(save.workingSummary);
      lines.push("");
    }

    if (save.workingFiles && save.workingFiles.length > 0) {
      lines.push(`**Key files:** ${save.workingFiles.slice(-5).join(", ")}`);
    }

    if (save.sessionLessons && save.sessionLessons.length > 0) {
      lines.push("");
      lines.push("**Recent learnings:**");
      for (const lesson of save.sessionLessons.slice(-3)) {
        lines.push(`- ${lesson}`);
      }
    }

    if (save.detectedPatterns && save.detectedPatterns.length > 0) {
      lines.push("");
      lines.push("**Detected patterns:**");
      for (const pattern of save.detectedPatterns.slice(-3)) {
        lines.push(`- ${pattern}`);
      }
    }

    lines.push("</session-recovery>");

    // Clear the save after generating recovery context
    fs.unlinkSync(savePath);

    return lines.join("\n");
  } catch {
    return null;
  }
}

// =============================================================================
// Main Hook Handler
// =============================================================================

export async function handleUserPromptSubmit(
  input: HookInput,
): Promise<HookOutput> {
  try {
    const projectPath = getProjectPath();

    if (!projectPath || !fs.existsSync(projectPath)) {
      return { continue: true };
    }

    const sessionId = input.session_id || "unknown";

    // CHECK: Have we already injected personality this session?
    if (!shouldInjectThisSession(projectPath, sessionId)) {
      // Already done for this session, skip silently
      return { continue: true };
    }

    // CHECK: Compaction recovery (inject saved state after compaction)
    const recoveryContext = checkCompactionRecoveryContext(
      projectPath,
      sessionId,
    );

    // CHECK: Pre-compaction save trigger
    const preCompactionWarning = checkAndTriggerPreCompactionSave(
      projectPath,
      sessionId,
    );

    // PRIORITY 1: Check for persistent brain (Claude's accumulated knowledge)
    const brain = loadPersistentBrain(projectPath);
    if (
      brain &&
      (brain.lessons.length > 0 || Object.keys(brain.fileInsights).length > 0)
    ) {
      let context = formatBrainContext(brain, projectPath, sessionId);
      // Prepend recovery context if we just recovered from compaction
      if (recoveryContext) {
        context = recoveryContext + "\n\n" + context;
      }
      if (preCompactionWarning) {
        context = preCompactionWarning + "\n\n" + context;
      }
      markSessionInjected(projectPath, sessionId);
      return { continue: true, result: context };
    }

    // PRIORITY 2: Fall back to dynamic detection + SQLite cache
    const projectId = computeProjectId(projectPath);
    const storage = createStorage();

    try {
      // Check for cached personality
      const cached = await getCachedPersonality(
        storage,
        projectId,
        projectPath,
      );

      if (cached) {
        const context = formatPersonalityContext(cached);
        await storage.close();
        markSessionInjected(projectPath, sessionId);
        return { continue: true, result: context };
      }

      // Extract fresh personality
      const personality = await extractProjectPersonality(
        projectPath,
        projectId,
      );

      if (!personality) {
        await storage.close();
        markSessionInjected(projectPath, sessionId); // Mark even if nothing to inject
        return { continue: true };
      }

      // Cache the personality
      await cachePersonality(storage, personality);
      await storage.close();

      const context = formatPersonalityContext(personality);
      markSessionInjected(projectPath, sessionId);
      return { continue: true, result: context };
    } catch (error) {
      await storage.close().catch(() => {});
      throw error;
    }
  } catch (error) {
    // Fail silently - don't block the user's prompt
    if (process.env.DEBUG) {
      console.error("[PersonalityHook] Error:", error);
    }
    return { continue: true };
  }
}

// =============================================================================
// Project Path Resolution
// =============================================================================

function getProjectPath(): string | null {
  // Priority: CLAUDE_PROJECT_DIR > cwd
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (projectDir && fs.existsSync(projectDir)) {
    return projectDir;
  }

  const cwd = process.cwd();
  if (cwd && fs.existsSync(cwd)) {
    return cwd;
  }

  return null;
}

function computeProjectId(projectPath: string): string {
  // Use path hash as stable project identifier
  const hash = crypto.createHash("sha256").update(projectPath).digest("hex");
  return hash.substring(0, 16);
}

// =============================================================================
// Cache Management
// =============================================================================

async function getCachedPersonality(
  storage: ContextStorage,
  projectId: string,
  projectPath: string,
): Promise<ProjectPersonality | null> {
  const profile = await storage.getProjectProfile(projectId);

  if (!profile) {
    return null;
  }

  // Check if cache is stale by time
  const age = Date.now() - profile.updatedAt;
  if (age > CACHE_TTL_MS) {
    return null;
  }

  // Check if config files have changed
  const currentHash = computeConfigHash(projectPath);
  if (currentHash !== profile.projectHash) {
    return null;
  }

  // Parse cached personality
  try {
    return JSON.parse(profile.personality) as ProjectPersonality;
  } catch {
    return null;
  }
}

async function cachePersonality(
  storage: ContextStorage,
  personality: ProjectPersonality,
): Promise<void> {
  const profile: ProjectProfile = {
    projectId: personality.projectId,
    personality: JSON.stringify(personality),
    updatedAt: Date.now(),
    projectHash: personality.configHash || "",
  };

  await storage.upsertProjectProfile(profile);
}

function computeConfigHash(projectPath: string): string {
  const contents: string[] = [];

  for (const configFile of CONFIG_FILES) {
    const filePath = path.join(projectPath, configFile);
    if (fs.existsSync(filePath)) {
      try {
        const stat = fs.statSync(filePath);
        contents.push(`${configFile}:${stat.mtimeMs}`);
      } catch {
        // Skip inaccessible files
      }
    }
  }

  return computeProjectHash(contents.join("|"));
}

// =============================================================================
// Personality Extraction
// =============================================================================

async function extractProjectPersonality(
  projectPath: string,
  projectId: string,
  options: ExtractionOptions = {},
): Promise<ProjectPersonality | null> {
  const stack = extractStackInfo(projectPath);
  const patterns = extractPatterns(projectPath, options.maxPatterns || 5);
  const gotchas = extractGotchas(projectPath, options.maxGotchas || 5);
  const keyFiles = identifyKeyFiles(projectPath);
  const projectName = extractProjectName(projectPath);

  // Only return personality if we found meaningful info
  if (
    stack.languages.length === 0 &&
    stack.frameworks.length === 0 &&
    patterns.length === 0 &&
    gotchas.length === 0
  ) {
    return null;
  }

  return {
    projectId,
    name: projectName,
    stack,
    patterns,
    conventions: [],
    gotchas,
    keyFiles,
    extractedAt: Date.now(),
    configHash: computeConfigHash(projectPath),
  };
}

function extractProjectName(projectPath: string): string {
  // Try package.json
  const packageJsonPath = path.join(projectPath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (pkg.name) return pkg.name;
    } catch {
      // Fall through
    }
  }

  // Try Cargo.toml
  const cargoPath = path.join(projectPath, "Cargo.toml");
  if (fs.existsSync(cargoPath)) {
    try {
      const cargo = fs.readFileSync(cargoPath, "utf-8");
      const match = cargo.match(/name\s*=\s*"([^"]+)"/);
      if (match) return match[1];
    } catch {
      // Fall through
    }
  }

  // Try pyproject.toml
  const pyprojectPath = path.join(projectPath, "pyproject.toml");
  if (fs.existsSync(pyprojectPath)) {
    try {
      const pyproject = fs.readFileSync(pyprojectPath, "utf-8");
      const match = pyproject.match(/name\s*=\s*"([^"]+)"/);
      if (match) return match[1];
    } catch {
      // Fall through
    }
  }

  // Fall back to directory name
  return path.basename(projectPath);
}

// =============================================================================
// Stack Detection
// =============================================================================

function extractStackInfo(projectPath: string): StackInfo {
  const stack: StackInfo = {
    languages: [],
    frameworks: [],
    buildTools: [],
  };

  // Detect from package.json
  const packageJsonPath = path.join(projectPath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      detectFromPackageJson(pkg, stack);
    } catch {
      // Skip invalid JSON
    }
  }

  // Detect from tsconfig.json
  const tsconfigPath = path.join(projectPath, "tsconfig.json");
  if (fs.existsSync(tsconfigPath)) {
    if (!stack.languages.includes("TypeScript")) {
      stack.languages.push("TypeScript");
    }
  }

  // Detect from Cargo.toml
  const cargoPath = path.join(projectPath, "Cargo.toml");
  if (fs.existsSync(cargoPath)) {
    stack.languages.push("Rust");
    stack.buildTools.push("Cargo");
    try {
      const cargo = fs.readFileSync(cargoPath, "utf-8");
      detectFromCargoToml(cargo, stack);
    } catch {
      // Skip
    }
  }

  // Detect from pyproject.toml or requirements.txt
  const pyprojectPath = path.join(projectPath, "pyproject.toml");
  const requirementsPath = path.join(projectPath, "requirements.txt");
  if (fs.existsSync(pyprojectPath) || fs.existsSync(requirementsPath)) {
    stack.languages.push("Python");
    if (fs.existsSync(pyprojectPath)) {
      try {
        const pyproject = fs.readFileSync(pyprojectPath, "utf-8");
        detectFromPyproject(pyproject, stack);
      } catch {
        // Skip
      }
    }
  }

  // Detect from go.mod
  const goModPath = path.join(projectPath, "go.mod");
  if (fs.existsSync(goModPath)) {
    stack.languages.push("Go");
    stack.buildTools.push("go");
  }

  // Detect from Gemfile (Ruby/Rails)
  const gemfilePath = path.join(projectPath, "Gemfile");
  if (fs.existsSync(gemfilePath)) {
    stack.languages.push("Ruby");
    try {
      const gemfile = fs.readFileSync(gemfilePath, "utf-8");
      detectFromGemfile(gemfile, stack);
    } catch {
      /* skip */
    }
  }

  // ==========================================================================
  // Enhanced Detection: ML/AI, Monorepo, Hybrid, Static
  // ==========================================================================

  // Detect ML/AI stack (Python projects with ML libraries)
  const mlStack = detectMLStack(projectPath);
  if (mlStack) {
    stack.mlStack = mlStack;
  }

  // Detect monorepo type
  const monorepoType = detectMonorepoType(projectPath);
  if (monorepoType !== "none") {
    stack.monorepoType = monorepoType;
  }

  // Detect hybrid stack (Python+JS, Rust+Tauri, etc.)
  const hybrid = detectHybridStack(projectPath, stack);
  if (hybrid.isHybrid) {
    stack.isHybridStack = true;
    stack.hybridDetails = hybrid.details;
  }

  // Determine overall project type
  stack.projectType = determineProjectType(stack, projectPath);

  return stack;
}

function detectFromPackageJson(
  pkg: Record<string, unknown>,
  stack: StackInfo,
): void {
  const deps = {
    ...asRecord(pkg.dependencies),
    ...asRecord(pkg.devDependencies),
  };

  // Languages
  if (deps["typescript"]) {
    stack.languages.push("TypeScript");
  } else {
    stack.languages.push("JavaScript");
  }

  // Frameworks
  if (deps["next"]) stack.frameworks.push("Next.js");
  if (deps["react"]) stack.frameworks.push("React");
  if (deps["vue"]) stack.frameworks.push("Vue");
  if (deps["svelte"]) stack.frameworks.push("Svelte");
  if (deps["express"]) stack.frameworks.push("Express");
  if (deps["fastify"]) stack.frameworks.push("Fastify");
  if (deps["nestjs"] || deps["@nestjs/core"]) stack.frameworks.push("NestJS");
  if (deps["electron"]) stack.frameworks.push("Electron");
  if (deps["@tauri-apps/api"]) stack.frameworks.push("Tauri");

  // State management
  if (deps["zustand"]) stack.stateManagement = "Zustand";
  if (deps["redux"] || deps["@reduxjs/toolkit"])
    stack.stateManagement = "Redux";
  if (deps["jotai"]) stack.stateManagement = "Jotai";
  if (deps["recoil"]) stack.stateManagement = "Recoil";
  if (deps["mobx"]) stack.stateManagement = "MobX";

  // Testing
  if (deps["vitest"]) stack.testing = "Vitest";
  if (deps["jest"]) stack.testing = "Jest";
  if (deps["mocha"]) stack.testing = "Mocha";
  if (deps["playwright"] || deps["@playwright/test"])
    stack.testing = "Playwright";

  // Styling
  if (deps["tailwindcss"]) stack.styling = "Tailwind CSS";
  if (deps["styled-components"]) stack.styling = "Styled Components";
  if (deps["@emotion/react"]) stack.styling = "Emotion";
  if (deps["sass"]) stack.styling = "Sass";

  // Database / ORM
  if (deps["prisma"] || deps["@prisma/client"]) stack.database = "Prisma";
  if (deps["drizzle-orm"]) stack.database = "Drizzle";
  if (deps["mongoose"]) stack.database = "MongoDB";
  if (deps["pg"]) stack.database = "PostgreSQL";
  if (deps["better-sqlite3"]) stack.database = "SQLite";
  if (deps["typeorm"]) stack.database = "TypeORM";

  // Backend Services (BaaS/PaaS)
  const services: string[] = [];
  if (deps["@supabase/supabase-js"] || deps["@supabase/ssr"])
    services.push("Supabase");
  if (deps["firebase"] || deps["firebase-admin"] || deps["@firebase/app"])
    services.push("Firebase");
  if (deps["@railway/cli"]) services.push("Railway");
  if (deps["@vercel/kv"] || deps["@vercel/postgres"] || deps["@vercel/blob"])
    services.push("Vercel");
  if (deps["@upstash/redis"] || deps["@upstash/ratelimit"])
    services.push("Upstash");
  if (deps["@planetscale/database"]) services.push("PlanetScale");
  if (deps["@neondatabase/serverless"]) services.push("Neon");
  if (services.length > 0) stack.backendServices = services;

  // UI Component Libraries
  if (deps["@mui/material"] || deps["@material-ui/core"])
    stack.uiLibrary = "Material UI";
  else if (deps["@mantine/core"]) stack.uiLibrary = "Mantine";
  else if (deps["@chakra-ui/react"]) stack.uiLibrary = "Chakra UI";
  else if (deps["@radix-ui/themes"] || hasMultipleRadixPrimitives(deps)) {
    // ShadCN uses Radix primitives but doesn't have its own package
    stack.uiLibrary = deps["class-variance-authority"] ? "ShadCN" : "Radix";
  } else if (deps["antd"]) stack.uiLibrary = "Ant Design";
  else if (deps["@headlessui/react"]) stack.uiLibrary = "Headless UI";

  // Audio/DSP (Web Audio)
  if (deps["tone"] || deps["howler"] || deps["pizzicato"]) {
    stack.audioDsp = {
      type: "web-audio",
      frameworks: [],
      languages: ["TypeScript", "JavaScript"],
      realtime: true,
    };
    if (deps["tone"]) stack.audioDsp.frameworks!.push("Tone.js");
    if (deps["howler"]) stack.audioDsp.frameworks!.push("Howler.js");
  }

  // Build tools
  if (deps["vite"]) stack.buildTools.push("Vite");
  if (deps["webpack"]) stack.buildTools.push("Webpack");
  if (deps["esbuild"]) stack.buildTools.push("esbuild");
  if (deps["turbo"]) stack.buildTools.push("Turborepo");

  // Note: Package manager detection would need projectPath - skip for now
}

/**
 * Check if project has multiple Radix UI primitives (indicates ShadCN/Radix usage)
 */
function hasMultipleRadixPrimitives(deps: Record<string, unknown>): boolean {
  const radixPackages = Object.keys(deps).filter(
    (k) =>
      k.startsWith("@radix-ui/react-") || k.startsWith("@radix-ui/primitive"),
  );
  return radixPackages.length >= 3; // ShadCN typically uses many primitives
}

function detectFromCargoToml(cargo: string, stack: StackInfo): void {
  // Detect common Rust frameworks
  if (cargo.includes("tauri")) stack.frameworks.push("Tauri");
  if (cargo.includes("actix")) stack.frameworks.push("Actix");
  if (cargo.includes("axum")) stack.frameworks.push("Axum");
  if (cargo.includes("rocket")) stack.frameworks.push("Rocket");
  if (cargo.includes("tokio")) stack.frameworks.push("Tokio");
  if (cargo.includes("sqlx")) stack.database = "SQLx";
  if (cargo.includes("diesel")) stack.database = "Diesel";
  if (cargo.includes("rusqlite")) stack.database = "SQLite";

  // Audio/DSP crates
  const hasAudio =
    cargo.includes("cpal") ||
    cargo.includes("rodio") ||
    cargo.includes("dasp") ||
    cargo.includes("fundsp") ||
    cargo.includes("vst") ||
    cargo.includes("clap-sys") ||
    cargo.includes("nih_plug") ||
    cargo.includes("baseplug");

  if (hasAudio) {
    const formats: string[] = [];
    const frameworks: string[] = [];

    if (cargo.includes("vst")) formats.push("VST3");
    if (cargo.includes("clap")) formats.push("CLAP");
    if (cargo.includes("nih_plug")) {
      frameworks.push("nih-plug");
      formats.push("VST3", "CLAP");
    }
    if (cargo.includes("baseplug")) frameworks.push("baseplug");
    if (cargo.includes("cpal")) frameworks.push("cpal");
    if (cargo.includes("rodio")) frameworks.push("rodio");
    if (cargo.includes("fundsp")) frameworks.push("FunDSP");

    stack.audioDsp = {
      type: formats.length > 0 ? "plugin" : "native",
      formats: formats.length > 0 ? [...new Set(formats)] : undefined,
      frameworks,
      languages: ["Rust"],
      realtime: true,
    };
  }
}

function detectFromPyproject(pyproject: string, stack: StackInfo): void {
  // Detect common Python frameworks
  if (pyproject.includes("fastapi")) stack.frameworks.push("FastAPI");
  if (pyproject.includes("django")) stack.frameworks.push("Django");
  if (pyproject.includes("flask")) stack.frameworks.push("Flask");
  if (pyproject.includes("pytest")) stack.testing = "pytest";
  if (pyproject.includes("sqlalchemy")) stack.database = "SQLAlchemy";

  // Build tools
  if (pyproject.includes("[tool.poetry]")) stack.buildTools.push("Poetry");
  if (pyproject.includes("[tool.uv]") || pyproject.includes("uv ="))
    stack.buildTools.push("uv");
}

function detectFromGemfile(gemfile: string, stack: StackInfo): void {
  // Rails framework
  if (gemfile.includes("'rails'") || gemfile.includes('"rails"')) {
    stack.frameworks.push("Rails");
  }
  // Sinatra (lightweight)
  if (gemfile.includes("'sinatra'") || gemfile.includes('"sinatra"')) {
    stack.frameworks.push("Sinatra");
  }
  // Testing
  if (gemfile.includes("'rspec'") || gemfile.includes('"rspec"')) {
    stack.testing = "RSpec";
  }
  // Database
  if (gemfile.includes("'pg'") || gemfile.includes('"pg"')) {
    stack.database = "PostgreSQL";
  }
  if (gemfile.includes("'mysql2'") || gemfile.includes('"mysql2"')) {
    stack.database = "MySQL";
  }
  if (gemfile.includes("'sqlite3'") || gemfile.includes('"sqlite3"')) {
    stack.database = "SQLite";
  }
}

// =============================================================================
// Enhanced Stack Detection - ML/AI, Data Science, Static, Monorepo
// =============================================================================

/**
 * ML/AI framework patterns for Python projects
 */
const ML_FRAMEWORKS = [
  "tensorflow",
  "torch",
  "pytorch",
  "keras",
  "jax",
  "flax",
  "transformers",
  "huggingface",
  "langchain",
  "openai",
  "anthropic",
  "scikit-learn",
  "sklearn",
  "xgboost",
  "lightgbm",
  "catboost",
  "onnx",
  "mlflow",
  "wandb",
  "optuna",
];

/**
 * Data science library patterns
 */
const DATA_SCIENCE_LIBS = [
  "pandas",
  "numpy",
  "scipy",
  "polars",
  "dask",
  "vaex",
];

/**
 * Visualization library patterns
 */
const VISUALIZATION_LIBS = [
  "matplotlib",
  "seaborn",
  "plotly",
  "altair",
  "bokeh",
  "holoviews",
];

/**
 * Detect ML/AI stack from Python configuration files
 */
function detectMLStack(projectPath: string): MLStackInfo | null {
  const mlStack: MLStackInfo = {
    frameworks: [],
    dataLibs: [],
    visualization: [],
    notebooks: false,
    modelDirs: [],
  };

  // Check requirements.txt
  const requirementsPath = path.join(projectPath, "requirements.txt");
  if (fs.existsSync(requirementsPath)) {
    try {
      const content = fs.readFileSync(requirementsPath, "utf-8").toLowerCase();
      detectMLLibsFromContent(content, mlStack);
    } catch {
      /* skip */
    }
  }

  // Check pyproject.toml
  const pyprojectPath = path.join(projectPath, "pyproject.toml");
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, "utf-8").toLowerCase();
      detectMLLibsFromContent(content, mlStack);
    } catch {
      /* skip */
    }
  }

  // Check for Jupyter notebooks
  try {
    const files = fs.readdirSync(projectPath);
    if (files.some((f) => f.endsWith(".ipynb"))) {
      mlStack.notebooks = true;
    }
    // Also check notebooks/ directory
    const notebooksDir = path.join(projectPath, "notebooks");
    if (
      fs.existsSync(notebooksDir) &&
      fs.statSync(notebooksDir).isDirectory()
    ) {
      const nbFiles = fs.readdirSync(notebooksDir);
      if (nbFiles.some((f) => f.endsWith(".ipynb"))) {
        mlStack.notebooks = true;
      }
    }
  } catch {
    /* skip */
  }

  // Check for common ML directories
  const mlDirs = [
    "models",
    "training",
    "datasets",
    "data",
    "checkpoints",
    "weights",
  ];
  for (const dir of mlDirs) {
    const dirPath = path.join(projectPath, dir);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      mlStack.modelDirs.push(dir);
    }
  }

  // Only return if we found ML-related content
  const hasMLContent =
    mlStack.frameworks.length > 0 ||
    mlStack.dataLibs.length > 0 ||
    mlStack.visualization.length > 0 ||
    mlStack.notebooks ||
    mlStack.modelDirs.length > 0;

  return hasMLContent ? mlStack : null;
}

/**
 * Helper to detect ML libraries from file content
 */
function detectMLLibsFromContent(content: string, mlStack: MLStackInfo): void {
  for (const lib of ML_FRAMEWORKS) {
    if (content.includes(lib)) {
      mlStack.frameworks.push(lib);
    }
  }
  for (const lib of DATA_SCIENCE_LIBS) {
    if (content.includes(lib)) {
      mlStack.dataLibs.push(lib);
    }
  }
  for (const lib of VISUALIZATION_LIBS) {
    if (content.includes(lib)) {
      mlStack.visualization.push(lib);
    }
  }
}

/**
 * Detect monorepo workspace configuration
 */
function detectMonorepoType(projectPath: string): MonorepoType {
  // Lerna
  if (fs.existsSync(path.join(projectPath, "lerna.json"))) {
    return "lerna";
  }

  // pnpm workspace
  if (fs.existsSync(path.join(projectPath, "pnpm-workspace.yaml"))) {
    return "pnpm-workspace";
  }

  // Turborepo
  if (fs.existsSync(path.join(projectPath, "turbo.json"))) {
    return "turborepo";
  }

  // Nx
  if (fs.existsSync(path.join(projectPath, "nx.json"))) {
    return "nx";
  }

  // Cargo workspace
  const cargoPath = path.join(projectPath, "Cargo.toml");
  if (fs.existsSync(cargoPath)) {
    try {
      const cargo = fs.readFileSync(cargoPath, "utf-8");
      if (cargo.includes("[workspace]")) {
        return "cargo-workspace";
      }
    } catch {
      /* skip */
    }
  }

  // npm/yarn workspaces via package.json
  const packageJsonPath = path.join(projectPath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (pkg.workspaces) {
        // Check for yarn.lock to differentiate
        if (fs.existsSync(path.join(projectPath, "yarn.lock"))) {
          return "yarn-workspaces";
        }
        return "npm-workspaces";
      }
    } catch {
      /* skip */
    }
  }

  return "none";
}

/**
 * Detect static HTML/CSS site (no build system)
 */
function detectStaticSite(projectPath: string): boolean {
  const hasIndexHtml = fs.existsSync(path.join(projectPath, "index.html"));
  const hasPackageJson = fs.existsSync(path.join(projectPath, "package.json"));
  const hasCargoToml = fs.existsSync(path.join(projectPath, "Cargo.toml"));
  const hasPyproject = fs.existsSync(path.join(projectPath, "pyproject.toml"));
  const hasRequirements = fs.existsSync(
    path.join(projectPath, "requirements.txt"),
  );

  // Static site: has index.html but NO build system indicators
  if (
    hasIndexHtml &&
    !hasPackageJson &&
    !hasCargoToml &&
    !hasPyproject &&
    !hasRequirements
  ) {
    // Additional check: no common build config files
    const buildConfigs = [
      "webpack.config.js",
      "vite.config.js",
      "vite.config.ts",
      "rollup.config.js",
      "gulpfile.js",
      "Gruntfile.js",
    ];
    const hasBuildConfig = buildConfigs.some((f) =>
      fs.existsSync(path.join(projectPath, f)),
    );
    return !hasBuildConfig;
  }
  return false;
}

/**
 * Detect hybrid stack (e.g., Python backend + JS frontend, Rust + Tauri)
 */
function detectHybridStack(
  _projectPath: string,
  stack: StackInfo,
): { isHybrid: boolean; details: string } {
  const hasPython = stack.languages.includes("Python");
  const hasJS =
    stack.languages.includes("JavaScript") ||
    stack.languages.includes("TypeScript");
  const hasRust = stack.languages.includes("Rust");
  const hasTauri = stack.frameworks.includes("Tauri");
  const hasElectron = stack.frameworks.includes("Electron");

  // Rust + Tauri (dual stack: Rust backend + JS/TS frontend)
  if (hasRust && hasTauri && hasJS) {
    return {
      isHybrid: true,
      details: "Rust + Tauri (Rust backend, TypeScript/React frontend)",
    };
  }

  // Rust + Electron (less common but possible)
  if (hasRust && hasElectron && hasJS) {
    return {
      isHybrid: true,
      details: "Rust + Electron (Rust native modules, JS frontend)",
    };
  }

  // Python + JavaScript (common: FastAPI/Django backend + React/Vue frontend)
  if (hasPython && hasJS) {
    const pyFramework =
      stack.frameworks.find((f) =>
        ["FastAPI", "Django", "Flask"].includes(f),
      ) || "Python";
    const jsFramework =
      stack.frameworks.find((f) =>
        ["React", "Vue", "Svelte", "Next.js"].includes(f),
      ) || "JavaScript";
    return {
      isHybrid: true,
      details: `${pyFramework} backend + ${jsFramework} frontend`,
    };
  }

  return { isHybrid: false, details: "" };
}

/**
 * Determine project type from detected stack information
 */
function determineProjectType(
  stack: StackInfo,
  projectPath: string,
): ProjectType {
  // Check for monorepo first (takes precedence)
  if (stack.monorepoType && stack.monorepoType !== "none") {
    return "monorepo";
  }

  // Check for ML/AI project
  if (stack.mlStack) {
    if (stack.mlStack.frameworks.length > 0) {
      return "ml-ai";
    }
    // Data science if only data libs and visualization
    if (
      stack.mlStack.dataLibs.length > 0 ||
      stack.mlStack.visualization.length > 0
    ) {
      return "data-science";
    }
  }

  // Check for static site
  if (detectStaticSite(projectPath)) {
    return "static-site";
  }

  // Check for desktop app
  if (stack.frameworks.some((f) => ["Electron", "Tauri"].includes(f))) {
    return "desktop-app";
  }

  // Check for mobile app
  if (
    stack.frameworks.some((f) =>
      ["React Native", "Flutter", "Expo"].includes(f),
    )
  ) {
    return "mobile-app";
  }

  // Check for audio/DSP project
  if (stack.audioDsp) {
    return "audio-dsp";
  }

  // Check for CLI tool (Rust or Go with specific patterns)
  const hasRustCli =
    stack.languages.includes("Rust") &&
    stack.frameworks.some((f) =>
      ["clap", "structopt"].includes(f.toLowerCase()),
    );
  const hasGoCli =
    stack.languages.includes("Go") &&
    !stack.frameworks.some((f) => ["Gin", "Echo", "Fiber"].includes(f));
  if (hasRustCli || hasGoCli) {
    return "cli-tool";
  }

  // Web classification
  const hasBackend = stack.frameworks.some((f) =>
    [
      "Express",
      "Fastify",
      "NestJS",
      "FastAPI",
      "Django",
      "Flask",
      "Actix",
      "Axum",
      "Rocket",
      "Gin",
      "Echo",
      "Rails",
      "Sinatra",
      "Hono",
      "Koa",
    ].includes(f),
  );
  // Also consider BaaS as backend
  const hasBaaS = (stack.backendServices?.length ?? 0) > 0;
  const hasFrontend = stack.frameworks.some((f) =>
    [
      "React",
      "Vue",
      "Svelte",
      "Next.js",
      "Nuxt",
      "Angular",
      "SvelteKit",
      "Remix",
      "Astro",
    ].includes(f),
  );

  if ((hasBackend || hasBaaS) && hasFrontend) {
    return "web-fullstack";
  }
  if (hasBackend) {
    return "web-backend";
  }
  if (hasFrontend) {
    // Frontend with BaaS is still fullstack
    return hasBaaS ? "web-fullstack" : "web-frontend";
  }

  // Check for library (has main export but no app entry point)
  const packageJsonPath = path.join(projectPath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (pkg.main || pkg.exports || pkg.module) {
        // Likely a library if it has exports but no "start" script
        if (!pkg.scripts?.start && !pkg.scripts?.dev) {
          return "library";
        }
      }
    } catch {
      /* skip */
    }
  }

  return "unknown";
}

/**
 * Find the project root by walking up the directory tree
 * Handles nested repos and monorepo sub-packages
 * Exported for use by other modules (e.g., active indexer, session state)
 */
export function findProjectRoot(startPath: string): string {
  // First, check CLAUDE_PROJECT_DIR environment variable
  const envProjectDir = process.env.CLAUDE_PROJECT_DIR;
  if (envProjectDir && fs.existsSync(envProjectDir)) {
    return envProjectDir;
  }

  // Walk up directory tree looking for project markers
  const projectMarkers = [
    ".git", // Git repository root
    "package.json", // Node.js project
    "Cargo.toml", // Rust project
    "pyproject.toml", // Python project
    "go.mod", // Go project
    "pom.xml", // Maven project
    "build.gradle", // Gradle project
    "CLAUDE.md", // Claude Code project marker
  ];

  // Monorepo markers (take precedence as root)
  const monorepoMarkers = [
    "lerna.json",
    "pnpm-workspace.yaml",
    "turbo.json",
    "nx.json",
  ];

  let currentPath = path.resolve(startPath);
  const rootPath = path.parse(currentPath).root;
  let foundProjectRoot: string | null = null;
  let foundMonorepoRoot: string | null = null;

  while (currentPath !== rootPath) {
    // Check for monorepo markers first (takes precedence)
    for (const marker of monorepoMarkers) {
      if (fs.existsSync(path.join(currentPath, marker))) {
        foundMonorepoRoot = currentPath;
        break;
      }
    }

    // Check for Cargo.toml with [workspace] (Rust monorepo)
    const cargoPath = path.join(currentPath, "Cargo.toml");
    if (fs.existsSync(cargoPath)) {
      try {
        const cargo = fs.readFileSync(cargoPath, "utf-8");
        if (cargo.includes("[workspace]")) {
          foundMonorepoRoot = currentPath;
        }
      } catch {
        /* skip */
      }
    }

    // Check for package.json with workspaces
    const packageJsonPath = path.join(currentPath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        if (pkg.workspaces) {
          foundMonorepoRoot = currentPath;
        }
      } catch {
        /* skip */
      }
    }

    // Check for regular project markers (if no monorepo found yet)
    if (!foundProjectRoot) {
      for (const marker of projectMarkers) {
        if (fs.existsSync(path.join(currentPath, marker))) {
          foundProjectRoot = currentPath;
          // Don't break - keep looking for potential monorepo root
          break;
        }
      }
    }

    currentPath = path.dirname(currentPath);
  }

  // Prefer monorepo root if found, otherwise use project root, fallback to start path
  return foundMonorepoRoot || foundProjectRoot || startPath;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Generate a tight ~50 token stack summary
 * Format: "Stack: Framework + Backend + Styling + UI [Type]"
 * Examples:
 *   "Stack: Next.js + Supabase + Tailwind + ShadCN [Full-Stack Web]"
 *   "Stack: Rust + nih-plug [Audio/DSP, VST3/CLAP]"
 *   "Stack: Rails + PostgreSQL [Backend/API]"
 */
function generateTightStackSummary(stack: StackInfo): string {
  const parts: string[] = [];

  // Primary framework (pick the most significant one)
  const primaryFramework =
    stack.frameworks.find((f) =>
      [
        "Next.js",
        "Nuxt",
        "SvelteKit",
        "Remix",
        "Astro",
        "Rails",
        "Django",
        "FastAPI",
        "Tauri",
        "Electron",
      ].includes(f),
    ) || stack.frameworks[0];

  if (primaryFramework) {
    parts.push(primaryFramework);
  } else if (stack.languages.length > 0) {
    // Fallback to primary language
    parts.push(stack.languages[0]);
  }

  // Backend service (BaaS/PaaS) or database
  if (stack.backendServices && stack.backendServices.length > 0) {
    parts.push(stack.backendServices[0]); // Primary service
  } else if (
    stack.database &&
    !["PostgreSQL", "MySQL", "SQLite"].includes(stack.database)
  ) {
    // Only show ORM/client, not raw DB drivers
    parts.push(stack.database);
  }

  // Styling (if Tailwind)
  if (stack.styling === "Tailwind CSS") {
    parts.push("Tailwind");
  }

  // UI Library
  if (stack.uiLibrary) {
    parts.push(stack.uiLibrary);
  }

  // Audio/DSP specific
  if (stack.audioDsp) {
    if (stack.audioDsp.frameworks && stack.audioDsp.frameworks.length > 0) {
      parts.push(stack.audioDsp.frameworks[0]);
    }
  }

  if (parts.length === 0) {
    return "";
  }

  // Build the summary
  let summary = `Stack: ${parts.join(" + ")}`;

  // Add type annotation
  const annotations: string[] = [];
  if (stack.projectType && stack.projectType !== "unknown") {
    annotations.push(formatProjectType(stack.projectType));
  }

  // Audio format info
  if (stack.audioDsp?.formats && stack.audioDsp.formats.length > 0) {
    annotations.push(stack.audioDsp.formats.join("/"));
  }

  // Monorepo info
  if (stack.monorepoType && stack.monorepoType !== "none") {
    annotations.push(
      formatMonorepoType(stack.monorepoType).replace(" monorepo", ""),
    );
  }

  if (annotations.length > 0) {
    summary += ` [${annotations.join(", ")}]`;
  }

  return summary;
}

/**
 * Format project type for display
 */
function formatProjectType(type: ProjectType): string {
  const labels: Record<ProjectType, string> = {
    "ml-ai": "ML/AI",
    "data-science": "Data Science",
    "web-fullstack": "Full-Stack Web",
    "web-frontend": "Frontend",
    "web-backend": "Backend/API",
    "static-site": "Static Site",
    "desktop-app": "Desktop App",
    "mobile-app": "Mobile App",
    "cli-tool": "CLI Tool",
    library: "Library",
    monorepo: "Monorepo",
    "audio-dsp": "Audio/DSP",
    unknown: "Unknown",
  };
  return labels[type] || type;
}

/**
 * Format monorepo type for display
 */
function formatMonorepoType(type: MonorepoType): string {
  const labels: Record<MonorepoType, string> = {
    lerna: "Lerna monorepo",
    "pnpm-workspace": "pnpm workspace",
    "npm-workspaces": "npm workspaces",
    "yarn-workspaces": "Yarn workspaces",
    turborepo: "Turborepo",
    nx: "Nx workspace",
    "cargo-workspace": "Cargo workspace",
    none: "",
  };
  return labels[type] || type;
}

// =============================================================================
// Pattern Extraction
// =============================================================================

function extractPatterns(projectPath: string, maxPatterns: number): Pattern[] {
  const patterns: Pattern[] = [];

  // Look for common pattern directories
  const patternDirs = [
    { dir: "src/components", pattern: "React components" },
    { dir: "src/hooks", pattern: "Custom React hooks" },
    { dir: "src/stores", pattern: "State management stores" },
    { dir: "src/lib", pattern: "Utility libraries" },
    { dir: "src/utils", pattern: "Utility functions" },
    { dir: "src/api", pattern: "API routes/handlers" },
    { dir: "src/services", pattern: "Service layer" },
    { dir: "src/models", pattern: "Data models" },
    { dir: "src/types", pattern: "TypeScript types" },
    { dir: "src/main", pattern: "Main process (Electron/Tauri)" },
    { dir: "src/renderer", pattern: "Renderer process" },
    { dir: "src/ipc-handlers", pattern: "IPC handlers" },
    { dir: "src/main/ipc-handlers", pattern: "IPC handler pattern" },
    { dir: "app", pattern: "Next.js app router" },
    { dir: "pages", pattern: "Next.js pages router" },
    { dir: "crates", pattern: "Rust crates" },
    { dir: "tests", pattern: "Test files" },
  ];

  for (const { dir, pattern } of patternDirs) {
    const fullPath = path.join(projectPath, dir);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      patterns.push({
        name: pattern,
        description: `Located in ${dir}/`,
        location: dir,
      });

      if (patterns.length >= maxPatterns) break;
    }
  }

  return patterns;
}

// =============================================================================
// Gotcha Extraction (from CLAUDE.md)
// =============================================================================

function extractGotchas(projectPath: string, maxGotchas: number): Gotcha[] {
  const gotchas: Gotcha[] = [];
  const claudeMdPath = path.join(projectPath, "CLAUDE.md");

  if (!fs.existsSync(claudeMdPath)) {
    return gotchas;
  }

  try {
    const content = fs.readFileSync(claudeMdPath, "utf-8");

    // Look for common gotcha patterns
    const gotchaPatterns = [
      /never\s+(.+)/gi,
      /don['']t\s+(.+)/gi,
      /always\s+(.+)/gi,
      /must\s+(.+)/gi,
      /avoid\s+(.+)/gi,
      /use\s+(\w+)\s+(?:for|instead|over)\s+(.+)/gi,
      /important[:\s]+(.+)/gi,
    ];

    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();

      // Skip headings and empty lines
      if (trimmed.startsWith("#") || trimmed.length === 0) continue;

      for (const pattern of gotchaPatterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(trimmed);
        if (match) {
          const issue =
            trimmed.length > 100 ? trimmed.substring(0, 97) + "..." : trimmed;
          gotchas.push({
            issue,
            prevention: "See CLAUDE.md",
            source: "CLAUDE.md",
          });
          break;
        }
      }

      if (gotchas.length >= maxGotchas) break;
    }
  } catch {
    // Skip unreadable files
  }

  return gotchas;
}

// =============================================================================
// Key File Identification
// =============================================================================

function identifyKeyFiles(projectPath: string): KeyFile[] {
  const keyFiles: KeyFile[] = [];

  const candidates: Array<{
    path: string;
    purpose: string;
    importance: KeyFile["importance"];
  }> = [
    {
      path: "CLAUDE.md",
      purpose: "Project instructions",
      importance: "critical",
    },
    {
      path: "package.json",
      purpose: "Node.js dependencies",
      importance: "critical",
    },
    {
      path: "tsconfig.json",
      purpose: "TypeScript config",
      importance: "important",
    },
    {
      path: "Cargo.toml",
      purpose: "Rust dependencies",
      importance: "critical",
    },
    {
      path: "pyproject.toml",
      purpose: "Python project config",
      importance: "critical",
    },
    {
      path: "src/main/index.ts",
      purpose: "Main entry (Electron/Tauri)",
      importance: "important",
    },
    {
      path: "src/index.ts",
      purpose: "Main entry point",
      importance: "important",
    },
    {
      path: "app/layout.tsx",
      purpose: "Next.js root layout",
      importance: "important",
    },
    {
      path: ".env.example",
      purpose: "Environment variables",
      importance: "reference",
    },
    {
      path: "README.md",
      purpose: "Project documentation",
      importance: "reference",
    },
  ];

  for (const candidate of candidates) {
    const fullPath = path.join(projectPath, candidate.path);
    if (fs.existsSync(fullPath)) {
      keyFiles.push({
        path: candidate.path,
        purpose: candidate.purpose,
        importance: candidate.importance,
      });
    }
  }

  return keyFiles;
}

// =============================================================================
// Context Formatting
// =============================================================================

function formatPersonalityContext(personality: ProjectPersonality): string {
  const lines: string[] = ["<project-personality>"];

  // Stack line
  const stackParts: string[] = [];
  if (personality.stack.languages.length > 0) {
    stackParts.push(...personality.stack.languages);
  }
  if (personality.stack.frameworks.length > 0) {
    stackParts.push(...personality.stack.frameworks);
  }
  if (personality.stack.stateManagement) {
    stackParts.push(personality.stack.stateManagement);
  }
  if (personality.stack.testing) {
    stackParts.push(personality.stack.testing);
  }
  if (personality.stack.database) {
    stackParts.push(personality.stack.database);
  }

  if (stackParts.length > 0) {
    lines.push(`Stack: ${stackParts.join(", ")}`);
  }

  // Patterns line
  if (personality.patterns.length > 0) {
    const patternDescriptions = personality.patterns
      .map((p) => `${p.name} in ${p.location || "src/"}`)
      .join(", ");
    lines.push(`Patterns: ${patternDescriptions}`);
  }

  // Gotchas line
  if (personality.gotchas.length > 0) {
    const gotchaList = personality.gotchas.map((g) => g.issue).join("; ");
    // Truncate if too long
    const truncated =
      gotchaList.length > 150
        ? gotchaList.substring(0, 147) + "..."
        : gotchaList;
    lines.push(`Gotchas: ${truncated}`);
  }

  // Key files line
  if (personality.keyFiles.length > 0) {
    const criticalFiles = personality.keyFiles
      .filter(
        (f) => f.importance === "critical" || f.importance === "important",
      )
      .map((f) => f.path)
      .slice(0, 5)
      .join(", ");
    if (criticalFiles) {
      lines.push(`Key files: ${criticalFiles}`);
    }
  }

  lines.push("</project-personality>");

  return lines.join("\n");
}
