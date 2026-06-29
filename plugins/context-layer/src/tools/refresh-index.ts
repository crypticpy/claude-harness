/**
 * refresh_index — incremental (or full) code-map update.
 *
 * With `changedFiles`, re-indexes just those paths (used by the post-edit
 * refresh). Without, runs/repairs a full index. No-op when PUNTAX_CODE_MAP is
 * off. Read/write is confined to the project-local code-map.db.
 */

import {
  codeMapEnabled,
  projectRoot,
  openCodeMap,
  runIndex,
} from "../indexer/code-map-service";

export interface RefreshIndexInput {
  projectPath: string;
  /** Repo-relative paths to refresh; omit for a full index. */
  changedFiles?: string[];
  /** Force a full re-walk (prunes deleted files, picks up new ones). */
  force?: boolean;
}

export interface RefreshIndexResult {
  enabled: boolean;
  indexed: boolean;
  mode: "full" | "incremental" | "disabled";
  filesSeen: number;
  filesIndexed: number;
  errors: number;
  symbols: number;
  edges: number;
  message?: string;
}

const DISABLED: RefreshIndexResult = {
  enabled: false,
  indexed: false,
  mode: "disabled",
  filesSeen: 0,
  filesIndexed: 0,
  errors: 0,
  symbols: 0,
  edges: 0,
  message: "Code map is disabled (set PUNTAX_CODE_MAP=true to enable).",
};

export async function refreshIndex(
  input: RefreshIndexInput,
): Promise<RefreshIndexResult> {
  if (!codeMapEnabled()) return DISABLED;

  const root = projectRoot(input.projectPath);
  const cm = openCodeMap(root);
  if (!cm) {
    return {
      ...DISABLED,
      enabled: true,
      message: "Could not open code-map.db.",
    };
  }

  try {
    const incremental =
      !input.force && !!input.changedFiles && input.changedFiles.length > 0;
    const res = runIndex(
      cm,
      root,
      incremental
        ? { mode: "incremental", changedFiles: input.changedFiles }
        : { mode: "full" },
    );
    const counts = cm.counts(res.projectId);
    return {
      enabled: true,
      indexed: counts.files > 0,
      mode: res.mode,
      filesSeen: res.filesSeen,
      filesIndexed: res.filesIndexed,
      errors: res.errors,
      symbols: counts.symbols,
      edges: counts.edges,
    };
  } catch (err) {
    return {
      ...DISABLED,
      enabled: true,
      message: `Index refresh failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  } finally {
    cm.close();
  }
}

export const refreshIndexToolDefinition = {
  name: "refresh_index",
  description:
    "Incrementally refresh the local code-map index. Pass changedFiles to re-index specific paths after edits, or omit for a full re-walk. No-op unless PUNTAX_CODE_MAP is enabled.",
  inputSchema: {
    type: "object",
    properties: {
      projectDir: {
        type: "string",
        description: "Project root directory (defaults to cwd)",
      },
      changedFiles: {
        type: "array",
        items: { type: "string" },
        description: "Repo-relative paths to re-index; omit for a full index",
      },
      force: {
        type: "boolean",
        description: "Force a full re-walk (prune deleted, pick up new files)",
      },
    },
  },
};
