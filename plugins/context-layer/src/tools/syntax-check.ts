/**
 * syntax_check — fast tree-sitter syntax-validity gate.
 *
 * Parses a file (or supplied content) with the tree-sitter grammar for its
 * language and reports ERROR / MISSING nodes with line+column. Use to confirm
 * an edit or a generated snippet parses BEFORE trusting it, without spinning up
 * a full compiler. Read-only — never writes the code-map.
 *
 * Fail-open: if grammars aren't available in this runtime, returns
 * `available: false` (the caller treats that as "couldn't check", not "broken").
 */

import * as fs from "fs";
import * as path from "path";

import {
  warmTreeSitter,
  readyTreeSitterBackend,
  type SyntaxCheckResult,
} from "../indexer/backends/tree-sitter";

export interface SyntaxCheckInput {
  filePath: string;
  /** Source to check. If omitted, the file is read from disk. */
  content?: string;
  /** Base dir for resolving a relative filePath (defaults to cwd). */
  projectPath?: string;
}

export interface SyntaxCheckToolResult extends SyntaxCheckResult {
  filePath: string;
  /** False when tree-sitter grammars are unavailable in this runtime. */
  available: boolean;
  /** Set when the file could not be read (not a syntax error). */
  readError?: string;
}

export async function syntaxCheckTool(
  input: SyntaxCheckInput,
): Promise<SyntaxCheckToolResult> {
  const { filePath } = input;
  // Warm-on-demand so the tool works even in runtimes that didn't boot-warm
  // (tests, direct handleRequest drivers). Idempotent + memoized.
  const backend = readyTreeSitterBackend() ?? (await warmTreeSitter());
  if (!backend) {
    return {
      filePath,
      language: "",
      supported: false,
      available: false,
      ok: true,
      errorCount: 0,
      errors: [],
    };
  }

  let content = input.content;
  if (content === undefined) {
    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.join(input.projectPath ?? process.cwd(), filePath);
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch (err) {
      return {
        filePath,
        language: "",
        supported: false,
        available: true,
        ok: false,
        errorCount: 0,
        errors: [],
        readError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const res = backend.checkSyntax(content, filePath);
  return { filePath, available: true, ...res };
}

export const syntaxCheckToolDefinition = {
  name: "syntax_check",
  description:
    "Tree-sitter syntax-validity gate: parse a file (or supplied content) and " +
    "report ERROR/MISSING nodes with line+column. Use to confirm an edit or a " +
    "generated snippet parses without running a compiler. TS/TSX/JS/Python; " +
    "read-only.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description:
          "Path to the file to check (sets the language by extension; read " +
          "from disk when `content` is omitted)",
      },
      content: {
        type: "string",
        description:
          "Optional source to check instead of reading the file — e.g. a " +
          "snippet you are about to write",
      },
      projectDir: {
        type: "string",
        description: "Project root directory (defaults to cwd)",
      },
    },
    required: ["filePath"],
  },
};
