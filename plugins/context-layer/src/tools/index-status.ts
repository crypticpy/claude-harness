/**
 * index_status — report code-map freshness and coverage.
 *
 * Read-only. Returns file/symbol/edge counts, stale-file count, and the last
 * index run. Never triggers indexing. Reflects PUNTAX_CODE_MAP state.
 */

import {
  indexStatus,
  projectRoot,
  type IndexStatusReport,
} from "../indexer/code-map-service";

export interface IndexStatusInput {
  projectPath: string;
}

export type IndexStatusResult = IndexStatusReport;

export async function indexStatusTool(
  input: IndexStatusInput,
): Promise<IndexStatusResult> {
  return indexStatus(projectRoot(input.projectPath));
}

export const indexStatusToolDefinition = {
  name: "index_status",
  description:
    "Report local code-map index freshness: file/symbol/edge counts, stale files, and the last index run. Read-only; does not trigger indexing.",
  inputSchema: {
    type: "object",
    properties: {
      projectDir: {
        type: "string",
        description: "Project root directory (defaults to cwd)",
      },
    },
  },
};
