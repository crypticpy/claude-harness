/**
 * session_checkpoint
 *
 * Return the latest deterministic session checkpoint written by the PreCompact
 * reducer (hooks/unified/modules/precompact-reducer.mjs) to
 * <projectDir>/.claude/context-layer/checkpoints.jsonl.
 *
 * Read-only and tolerant of corrupted lines. No LLM.
 */

import * as fs from "fs";
import * as path from "path";

export interface SessionCheckpointInput {
  projectPath: string;
  sessionId?: string;
}

export interface Checkpoint {
  timestamp?: string;
  type?: string;
  session_id?: string;
  source?: string;
  checkpointIndex?: number;
  /** One-line "where was I" headline synthesized by the reducer (deriveFocus). */
  focus?: string;
  workingFiles?: string[];
  changedFiles?: string[];
  symbolsTouched?: string[];
  testsRun?: string[];
  failures?: string[];
  decisions?: string[];
  openLoops?: string[];
  nextActions?: string[];
  permissionDenials?: string[];
  risk?: string;
  [key: string]: unknown;
}

export interface SessionCheckpointResult {
  checkpoint: Checkpoint | null;
  total: number;
  message?: string;
}

function checkpointsPath(projectPath: string): string {
  return path.join(
    projectPath,
    ".claude",
    "context-layer",
    "checkpoints.jsonl",
  );
}

export async function sessionCheckpoint(
  input: SessionCheckpointInput,
): Promise<SessionCheckpointResult> {
  const file = checkpointsPath(input.projectPath);
  if (!fs.existsSync(file)) {
    return {
      checkpoint: null,
      total: 0,
      message: "No checkpoints recorded yet.",
    };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return {
      checkpoint: null,
      total: 0,
      message: "Could not read checkpoints.",
    };
  }

  let latest: Checkpoint | null = null;
  let total = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let c: Checkpoint;
    try {
      c = JSON.parse(line) as Checkpoint;
    } catch {
      continue; // tolerate corruption
    }
    if (!c || c.type !== "checkpoint") continue;
    if (input.sessionId && c.session_id !== input.sessionId) continue;
    total++;
    latest = c; // file is append-only; last match wins
  }

  return {
    checkpoint: latest,
    total,
    message: latest
      ? undefined
      : "No checkpoint matched the requested session.",
  };
}

export const sessionCheckpointToolDefinition = {
  name: "session_checkpoint",
  description:
    "Return the latest deterministic session checkpoint reduced from the event ledger. Read the `focus` field first — it's a one-line 'where was I' headline (in-flight files, open loops, last test, next action); the full record (working/changed files, failures, open loops, next actions, risk) follows. Use on resume to recover where work left off — no LLM, no token-heavy transcript replay.",
  inputSchema: {
    type: "object",
    properties: {
      projectDir: {
        type: "string",
        description: "Project root directory (defaults to cwd)",
      },
      sessionId: {
        type: "string",
        description: "Optional: restrict to a specific session id",
      },
    },
  },
};
