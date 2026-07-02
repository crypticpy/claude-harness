/**
 * refactor_manifest — append-only work-list for long refactors.
 *
 * Add the full work-list up front (one item per file/symbol to touch); the
 * post-edit hook ticks items off automatically as their files are edited, and
 * the SessionStart(compact) hook re-injects the remaining items after every
 * compaction — so a 60-file refactor can't silently lose its tail when context
 * compacts. Items are content-addressed (same file+symbol+note → same id), so
 * re-adding is idempotent.
 */

import * as path from "path";

import {
  readManifest,
  manifestAdd,
  manifestTick,
  manifestDrop,
  clearManifest,
  type ManifestState,
  type ManifestItemInput,
} from "../storage/steering-store";

export interface RefactorManifestInput {
  action: "add" | "tick" | "drop" | "status" | "clear";
  items?: ManifestItemInput[];
  ids?: string[];
  reason?: string;
  projectPath?: string;
}

export interface RefactorManifestResult {
  action: RefactorManifestInput["action"];
  state: ManifestState;
  addedIds?: string[];
  tickedIds?: string[];
  droppedIds?: string[];
  cleared?: boolean;
}

export function refactorManifest(input: RefactorManifestInput): RefactorManifestResult {
  const projectDir = path.resolve(input.projectPath ?? process.cwd());

  switch (input.action) {
    case "add": {
      const addedIds = manifestAdd(projectDir, input.items ?? []);
      return { action: "add", addedIds, state: readManifest(projectDir) };
    }
    case "tick": {
      const tickedIds = manifestTick(projectDir, input.ids ?? []);
      return { action: "tick", tickedIds, state: readManifest(projectDir) };
    }
    case "drop": {
      const droppedIds = manifestDrop(projectDir, input.ids ?? [], input.reason);
      return { action: "drop", droppedIds, state: readManifest(projectDir) };
    }
    case "status":
      return { action: "status", state: readManifest(projectDir) };
    case "clear": {
      const cleared = clearManifest(projectDir);
      return { action: "clear", cleared, state: readManifest(projectDir) };
    }
    default:
      throw new Error(`refactor_manifest: unknown action ${String(input.action)}`);
  }
}

export const refactorManifestToolDefinition = {
  name: "refactor_manifest",
  description:
    "Append-only work-list for long refactors/migrations. Add every file/symbol to touch up front; the harness ticks items automatically when their file is edited and re-injects the remaining items after every compaction, so no item is silently lost to context loss. Use status to see what's left; drop for items that turn out not to need changes.",
  inputSchema: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["add", "tick", "drop", "status", "clear"],
        description:
          "add = append work items; tick = mark ids done; drop = mark ids won't-do; status = fold and report; clear = delete the whole list",
      },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["file"],
          properties: {
            file: { type: "string", description: "Repo-relative (or absolute) file to change" },
            symbol: { type: "string", description: "Specific symbol within the file (optional)" },
            note: { type: "string", description: "What to do there (optional, keep short)" },
          },
        },
        description: "Work items for action=add",
      },
      ids: {
        type: "array",
        items: { type: "string" },
        description: "Item ids for action=tick|drop (from add/status output)",
      },
      reason: {
        type: "string",
        description: "Why the items are dropped (action=drop)",
      },
      projectPath: {
        type: "string",
        description: "Project root (defaults to cwd)",
      },
    },
  },
};
