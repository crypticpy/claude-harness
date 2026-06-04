/**
 * Memento Recall Tools
 *
 * Provides Claude with tools to search conversation history using the recall
 * model's (gpt-5.4-mini) large context window as a "trusted advisor" that
 * maintains perfect memory.
 */

import * as fs from "fs";
import * as path from "path";

const LOG_DIR = path.join(
  process.env.HOME!,
  ".claude",
  "hooks",
  "unified",
  "logs",
);
const FILE_EDITS_DB = path.join(LOG_DIR, "file-edits.json");

interface MementoConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  maxTokens: number;
  reasoningEffort?: string;
}

/** Extract assistant text from an OpenAI Responses API result. */
function extractResponsesText(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text)
    return data.output_text;
  if (!Array.isArray(data?.output)) return "";
  let text = "";
  for (const item of data.output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part?.type === "output_text" && typeof part.text === "string")
          text += part.text;
      }
    }
  }
  return text;
}

/**
 * Search conversation history using the recall model (gpt-5.4-mini)
 *
 * This is the "Memento advisor" - it can answer questions about what happened
 * in past operations, even after Claude's context has been compacted multiple times.
 */
export async function recallHistory(input: {
  query: string;
  sessionId?: string;
  projectPath?: string;
  lookback?: "session" | "day" | "week" | "all";
}): Promise<{
  answer: string;
  relevantOperations: Array<{
    timestamp: string;
    tool: string;
    summary: string;
  }>;
  searchedEntries: number;
}> {
  const { query, sessionId, lookback = "session" } = input;

  // Load logs
  const logs = loadLogs(sessionId, lookback);

  if (logs.length === 0) {
    return {
      answer: "No conversation history found.",
      relevantOperations: [],
      searchedEntries: 0,
    };
  }

  // Get config
  const config = loadMementoConfig();
  if (!config) {
    throw new Error("Memento recall requires API key configuration");
  }

  // Build context for the recall model
  const context = logs
    .map((log) => {
      return `[${log.timestamp}] ${log.tool_name}: ${log.metadata?.file || log.metadata?.query || ""}
${log.output_summary || ""}`;
    })
    .join("\n\n");

  const prompt = `You are a conversation historian. Analyze this log of Claude Code operations and answer the user's question.

OPERATION LOG:
${context.slice(0, 800000)} 

USER QUESTION: ${query}

Provide a concise, accurate answer based ONLY on the operations above. If the answer isn't in the logs, say so.

Answer:`;

  // Call the recall model (OpenAI Responses API)
  try {
    const body: any = {
      model: config.model,
      input: prompt,
      max_output_tokens: config.maxTokens,
    };
    if (config.reasoningEffort) {
      body.reasoning = { effort: config.reasoningEffort };
    }

    const response = await fetch(`${config.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/anthropics/claude-code",
        "X-Title": "Claude Code Memento Recall",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Recall model call failed: ${response.status}`);
    }

    const data = (await response.json()) as any;
    const answer = extractResponsesText(data).trim() || "No answer generated.";

    // Extract relevant operations (simple keyword matching for now)
    const queryTerms = query.toLowerCase().split(/\s+/);
    const relevantOps = logs
      .filter((log) => {
        const text =
          `${log.tool_name} ${log.metadata?.file || ""} ${log.output_summary || ""}`.toLowerCase();
        return queryTerms.some((term) => text.includes(term));
      })
      .slice(0, 10)
      .map((log) => ({
        timestamp: log.timestamp,
        tool: log.tool_name,
        summary: log.output_summary?.slice(0, 200) || log.metadata?.file || "",
      }));

    return {
      answer,
      relevantOperations: relevantOps,
      searchedEntries: logs.length,
    };
  } catch (err: any) {
    throw new Error(`Memento recall failed: ${err.message}`);
  }
}

/**
 * Get detailed edit history for a specific file
 */
export async function fileEditHistory(input: {
  filePath: string;
  sessionId?: string;
}): Promise<{
  filePath: string;
  totalEdits: number;
  sessionEdits: number;
  firstEdit: string;
  lastEdit: string;
  recentChanges: Array<{
    timestamp: string;
    summary: string;
  }>;
}> {
  const { filePath, sessionId } = input;

  if (!fs.existsSync(FILE_EDITS_DB)) {
    throw new Error("No edit history database found");
  }

  const db = JSON.parse(fs.readFileSync(FILE_EDITS_DB, "utf-8"));
  const fileData = db.files[filePath];

  if (!fileData) {
    throw new Error(`No edit history found for ${filePath}`);
  }

  const sessionData = sessionId ? fileData.sessions[sessionId] : null;

  return {
    filePath,
    totalEdits: fileData.editCount,
    sessionEdits: sessionData?.count || 0,
    firstEdit: fileData.firstEdit,
    lastEdit: fileData.lastEdit,
    recentChanges: (sessionData?.edits || []).slice(-10).map((e: any) => ({
      timestamp: e.timestamp,
      summary: e.summary || "(no summary yet)",
    })),
  };
}

/**
 * Search tool call history with filters
 */
export async function searchToolHistory(input: {
  toolName?: string;
  filePath?: string;
  since?: string; // ISO timestamp
  sessionId?: string;
  limit?: number;
}): Promise<{
  matches: Array<{
    timestamp: string;
    tool: string;
    file?: string;
    summary: string;
  }>;
  totalMatches: number;
}> {
  const { toolName, filePath, since, sessionId, limit = 50 } = input;

  const logs = loadLogs(sessionId, "all");

  let filtered = logs;

  // Apply filters
  if (toolName) {
    filtered = filtered.filter((log) => log.tool_name === toolName);
  }

  if (filePath) {
    filtered = filtered.filter((log) => log.metadata?.file === filePath);
  }

  if (since) {
    const sinceDate = new Date(since);
    filtered = filtered.filter((log) => new Date(log.timestamp) >= sinceDate);
  }

  const matches = filtered.slice(0, limit).map((log) => ({
    timestamp: log.timestamp,
    tool: log.tool_name,
    file: log.metadata?.file,
    summary: log.output_summary || log.metadata?.command || "",
  }));

  return {
    matches,
    totalMatches: filtered.length,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function loadLogs(sessionId?: string, lookback: string = "session"): any[] {
  if (!fs.existsSync(LOG_DIR)) return [];

  const logs: any[] = [];

  if (lookback === "session" && sessionId) {
    // Load specific session
    const sessionLog = path.join(LOG_DIR, `${sessionId}.jsonl`);
    if (fs.existsSync(sessionLog)) {
      const lines = fs
        .readFileSync(sessionLog, "utf-8")
        .split("\n")
        .filter((l) => l.trim());
      logs.push(...lines.map((line) => JSON.parse(line)));
    }
  } else {
    // Load multiple sessions based on lookback
    const files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith(".jsonl"));
    const cutoff = getCutoffDate(lookback);

    for (const file of files) {
      const filePath = path.join(LOG_DIR, file);
      const stat = fs.statSync(filePath);

      if (cutoff && stat.mtime < cutoff) continue;

      const lines = fs
        .readFileSync(filePath, "utf-8")
        .split("\n")
        .filter((l) => l.trim());
      logs.push(...lines.map((line) => JSON.parse(line)));
    }
  }

  // Sort by timestamp
  logs.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  return logs;
}

function getCutoffDate(lookback: string): Date | null {
  const now = new Date();

  switch (lookback) {
    case "day":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "week":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "all":
      return null;
    default:
      return null;
  }
}

function loadMementoConfig(): MementoConfig | null {
  // Try unified hooks config
  const hookConfig = path.join(
    process.env.HOME!,
    ".claude",
    "hooks",
    "unified",
    "config.json",
  );
  if (fs.existsSync(hookConfig)) {
    try {
      const config = JSON.parse(fs.readFileSync(hookConfig, "utf-8"));
      const apiKey = getApiKey();
      if (config.llm?.recall && apiKey) {
        return {
          ...config.llm.recall,
          apiKey,
        };
      }
    } catch (e) {}
  }

  return null;
}

function getApiKey(): string | null {
  // Check permission hook config
  const permHookConfig = path.join(
    process.env.HOME!,
    ".claude-code-fast-permission-hook",
    "config.json",
  );
  if (fs.existsSync(permHookConfig)) {
    try {
      const config = JSON.parse(fs.readFileSync(permHookConfig, "utf-8"));
      if (config.llm?.apiKey) return config.llm.apiKey;
    } catch (e) {}
  }

  // Check env
  return process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || null;
}

// Export tool definitions for MCP
export const mementoToolDefinitions = [
  {
    name: "recall_history",
    description:
      "Ask the recall model about past conversation history. Use this when you need to remember what happened earlier in this session or in previous sessions. The AI advisor has perfect memory of all operations.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'Question about past operations (e.g. "When did I last edit auth.ts?" or "What changes have I made to the API?")',
        },
        sessionId: {
          type: "string",
          description: "Optional: specific session ID to search",
        },
        lookback: {
          type: "string",
          enum: ["session", "day", "week", "all"],
          description: "How far back to search (default: session)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "file_edit_history",
    description:
      "Get detailed edit history for a specific file, including how many times it was edited and summaries of recent changes.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Path to the file",
        },
        sessionId: {
          type: "string",
          description: "Optional: specific session ID",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "search_tool_history",
    description:
      'Search past tool calls with filters. Useful for finding specific operations like "all times I ran tests" or "recent git commands".',
    inputSchema: {
      type: "object",
      properties: {
        toolName: {
          type: "string",
          description: "Filter by tool name (Edit, Write, Bash, etc.)",
        },
        filePath: {
          type: "string",
          description: "Filter by file path",
        },
        since: {
          type: "string",
          description: "ISO timestamp to search from",
        },
        sessionId: {
          type: "string",
          description: "Filter to specific session",
        },
        limit: {
          type: "number",
          description: "Max results (default: 50)",
        },
      },
    },
  },
];
