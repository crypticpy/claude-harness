/**
 * mission_charter — set/get/clear the session's steering charter.
 *
 * The charter is the anti-drift anchor for very long sessions: the mission
 * statement, scope (path prefixes), and hard constraints are stored verbatim
 * in charter.json and re-injected VERBATIM by the SessionStart(compact) hook
 * after every compaction — the goal survives lossy summarization. The
 * post-edit hook also warns when an edit lands outside the declared scope.
 */

import * as path from "path";

import {
  readCharter,
  writeCharter,
  clearCharter,
  type Charter,
  type CharterInput,
} from "../storage/steering-store";

export interface MissionCharterInput {
  action: "set" | "get" | "clear";
  mission?: string;
  scope?: string[];
  constraints?: string[];
  sessionId?: string | null;
  projectPath?: string;
}

export interface MissionCharterResult {
  action: MissionCharterInput["action"];
  charter: Charter | null;
  cleared?: boolean;
}

export function missionCharter(input: MissionCharterInput): MissionCharterResult {
  const projectDir = path.resolve(input.projectPath ?? process.cwd());

  switch (input.action) {
    case "set": {
      const charterInput: CharterInput = {
        mission: input.mission ?? "",
        scope: input.scope,
        constraints: input.constraints,
        sessionId: input.sessionId,
      };
      return { action: "set", charter: writeCharter(projectDir, charterInput) };
    }
    case "get":
      return { action: "get", charter: readCharter(projectDir) };
    case "clear":
      return { action: "clear", charter: null, cleared: clearCharter(projectDir) };
    default:
      throw new Error(`mission_charter: unknown action ${String(input.action)}`);
  }
}

export const missionCharterToolDefinition = {
  name: "mission_charter",
  description:
    "Set, read, or clear the session's steering charter (mission statement, scope path-prefixes, hard constraints). Set it when a plan is confirmed or a long refactor starts; the harness re-injects it VERBATIM after every compaction so the goal survives context loss, and warns on edits outside the declared scope. Clear it when the steered stretch of work is finished.",
  inputSchema: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["set", "get", "clear"],
        description: "set = write/overwrite the charter; get = read it; clear = remove it",
      },
      mission: {
        type: "string",
        description:
          "The mission statement, verbatim (required for set). Write it as the durable goal — it is re-injected word-for-word, never summarized.",
      },
      scope: {
        type: "array",
        items: { type: "string" },
        description:
          "Repo-relative path prefixes the work should stay within (e.g. [\"src/auth/\", \"tests/auth/\"]). Edits outside these trigger a drift warning. Empty = no scope check.",
      },
      constraints: {
        type: "array",
        items: { type: "string" },
        description: "Hard rules to carry across compactions, verbatim (e.g. \"do not touch the public API\").",
      },
      sessionId: {
        type: "string",
        description: "Originating session id (optional provenance)",
      },
      projectPath: {
        type: "string",
        description: "Project root (defaults to cwd)",
      },
    },
  },
};
