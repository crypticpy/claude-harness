/**
 * code_map_outline — token-cheap structural map of a directory.
 *
 * Per file: its top-level symbols ({name, kind, line}) and the in-project files
 * it imports — no bodies, no signatures. Use to orient in an unfamiliar area or
 * pick which files are worth a full read, at a fraction of the tokens of reading
 * them. Pulls straight from the code-map graph (lazy-indexes on first call).
 *
 * Read-only and fail-open: an unopenable / empty code map returns
 * `indexed: false` with no files rather than throwing.
 */

import * as path from "path";

import {
  ensureProjectIndexed,
  openCodeMap,
  projectRoot,
} from "../indexer/code-map-service";
import { projectIdFor } from "../storage/code-map";

export interface CodeMapOutlineInput {
  projectPath: string;
  /** Repo-relative subdirectory to scope the outline (defaults to whole repo). */
  dir?: string;
}

export interface OutlineSymbol {
  name: string;
  kind: string;
  line: number;
}

export interface OutlineFile {
  path: string;
  language: string | null;
  symbols: OutlineSymbol[];
  /** Repo-relative paths of the in-project files this file imports. */
  imports: string[];
}

export interface CodeMapOutlineResult {
  projectRoot: string;
  dir: string | null;
  indexed: boolean;
  fileCount: number;
  files: OutlineFile[];
}

/** Normalize a caller dir to a repo-relative prefix, or null for whole-repo. */
function normalizeDir(root: string, dir: string | undefined): string | null {
  if (!dir) return null;
  const rel = path.isAbsolute(dir) ? path.relative(root, dir) : dir;
  const trimmed = rel.replace(/^\.\/+/, "").replace(/\/+$/, "");
  return trimmed === "" || trimmed === "." ? null : trimmed;
}

export async function codeMapOutlineTool(
  input: CodeMapOutlineInput,
): Promise<CodeMapOutlineResult> {
  const root = projectRoot(input.projectPath);
  const dir = normalizeDir(root, input.dir);
  const empty: CodeMapOutlineResult = {
    projectRoot: root,
    dir,
    indexed: false,
    fileCount: 0,
    files: [],
  };

  // Lazy first index (no force; no-op once the project has files).
  ensureProjectIndexed(root);

  const cm = openCodeMap(root);
  if (!cm) return empty;
  try {
    const projectId = projectIdFor(root);
    const inDir = (p: string) => !dir || p === dir || p.startsWith(dir + "/");
    const fileRecords = cm.listFiles(projectId).filter((f) => inDir(f.path));
    if (fileRecords.length === 0) return { ...empty, indexed: true };

    const files: OutlineFile[] = fileRecords.map((f) => {
      const symbols = cm
        .getSymbolsForFile(f.id)
        .filter((s) => s.parentSymbolId === null)
        .map((s) => ({ name: s.name, kind: s.kind, line: s.startLine }));

      const imports = Array.from(
        new Set(
          cm
            .edgesFromFile(f.id)
            .filter((e) => e.kind === "imports" && e.targetFileId)
            .map((e) => cm.getFileById(e.targetFileId!)?.path)
            .filter((p): p is string => Boolean(p)),
        ),
      ).sort();

      return { path: f.path, language: f.language, symbols, imports };
    });

    return {
      projectRoot: root,
      dir,
      indexed: true,
      fileCount: files.length,
      files,
    };
  } catch {
    return empty;
  } finally {
    cm.close();
  }
}

export const codeMapOutlineToolDefinition = {
  name: "code_map_outline",
  description:
    "Token-cheap structural map of a directory: per file, its top-level " +
    "symbols ({name, kind, line}) and the in-project files it imports — no " +
    "bodies. Use to orient in unfamiliar code or pick what's worth a full " +
    "read. Reads the code-map graph; lazy-indexes on first call. Read-only.",
  inputSchema: {
    type: "object",
    properties: {
      dir: {
        type: "string",
        description:
          "Repo-relative subdirectory to scope the outline (defaults to the " +
          "whole repo — pass a dir to keep the result small)",
      },
      projectDir: {
        type: "string",
        description: "Project root directory (defaults to cwd)",
      },
    },
  },
};
