#!/usr/bin/env node
/**
 * MCP Server for Context Layer Tools
 *
 * Exposes the context-layer tools (semantic_lookup, impact_check,
 * symbol_context, syntax_check, code_map_outline, brain_search, memory_write,
 * mission_charter, refactor_manifest, …) over MCP stdio. This file is the LIVE
 * boundary: a tool or param must appear in the inline TOOLS schema AND the
 * handleRequest switch below, or it does not exist to callers.
 */

import * as readline from "readline";
import {
  semanticLookup,
  batchSemanticLookup,
  formatLookupResult,
  checkImpact,
  getSymbolContext,
  brainSearch,
  mistakeLog,
  sessionSummary,
  whatChanged,
  puntaxContext,
  sessionCheckpoint,
  refreshIndex,
  indexStatusTool,
  memoryWrite,
  syntaxCheckTool,
  codeMapOutlineTool,
  missionCharter,
  refactorManifest,
  brainToolDefinitions,
  whatChangedToolDefinition,
  puntaxContextToolDefinition,
  sessionCheckpointToolDefinition,
  refreshIndexToolDefinition,
  indexStatusToolDefinition,
  memoryWriteToolDefinition,
  syntaxCheckToolDefinition,
  codeMapOutlineToolDefinition,
  missionCharterToolDefinition,
  refactorManifestToolDefinition,
  type SemanticLookupInput,
  type SemanticLookupResult,
  type ImpactCheckInput,
  type SymbolContextInput,
  type PuntaxContextInput,
  type MemoryWriteInput,
  type MissionCharterInput,
  type RefactorManifestInput,
} from "./tools";
import { recordFileAccess } from "./learn";
import { warmTreeSitter } from "./indexer/backends/tree-sitter";

interface MCPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

const TOOLS = [
  {
    name: "semantic_lookup",
    description:
      "Get file summaries and metadata before reading full content. Use this to understand what a file contains without consuming context reading the whole thing.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "File paths to look up (relative or absolute)",
        },
        outlineOnly: {
          type: "boolean",
          description:
            "Compact outline: file path, line count, complexity, and export/" +
            "import counts only — drops the prose summary and dependency list. " +
            "Use to decide whether a file is worth a full read at minimal token cost.",
        },
        projectDir: {
          type: "string",
          description: "Project root directory (defaults to cwd)",
        },
      },
      required: ["paths"],
    },
  },
  {
    name: "impact_check",
    description:
      "Check what would break if you modify a file or symbol. Returns dependents, callers, and risk assessment.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Path to the file being modified",
        },
        symbolName: {
          type: "string",
          description:
            "Optional: specific symbol being modified (function, class, etc.)",
        },
        changeType: {
          type: "string",
          enum: ["modify", "delete", "rename"],
          description: "Type of change being made",
        },
        projectDir: {
          type: "string",
          description: "Project root directory (defaults to cwd)",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "symbol_context",
    description:
      "Get type information, documentation, and related symbols for any code symbol without reading the entire file.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Path to the file containing the symbol",
        },
        symbolName: {
          type: "string",
          description: "Name of the symbol to look up",
        },
        line: {
          type: "number",
          description: "Optional: line number where symbol appears",
        },
        signatureOnly: {
          type: "boolean",
          description:
            "Compact output: name, kind, signature, and location only — no " +
            "related symbols or documentation.",
        },
        projectDir: {
          type: "string",
          description: "Project root directory (defaults to cwd)",
        },
      },
      required: ["filePath", "symbolName"],
    },
  },
  // PUNTAX context router (primary tool)
  puntaxContextToolDefinition,
  // Deterministic session checkpoint
  sessionCheckpointToolDefinition,
  // Code-map index tools
  refreshIndexToolDefinition,
  indexStatusToolDefinition,
  codeMapOutlineToolDefinition,
  // Tree-sitter syntax-validity gate
  syntaxCheckToolDefinition,
  // Typed memory write
  memoryWriteToolDefinition,
  // Long-session steering
  missionCharterToolDefinition,
  refactorManifestToolDefinition,
  // Brain tools
  ...brainToolDefinitions,
  // What changed tool
  whatChangedToolDefinition,
];

export async function handleRequest(
  request: MCPRequest,
): Promise<MCPResponse> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: "context-layer",
              version: "0.1.0",
            },
          },
        };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: TOOLS },
        };

      case "tools/call": {
        const toolName = (params as { name: string })?.name;
        const args =
          (params as { arguments: Record<string, unknown> })?.arguments || {};
        const projectDir = (args.projectDir as string) || process.cwd();

        let result: unknown;

        switch (toolName) {
          case "semantic_lookup": {
            const paths = args.paths as string[];
            const outlineOnly = args.outlineOnly === true;
            // Track file accesses for auto-learn
            for (const p of paths) {
              recordFileAccess(projectDir, p, "semantic_lookup");
            }
            if (paths.length === 1) {
              const input: SemanticLookupInput = {
                filePath: paths[0],
                projectPath: projectDir,
                outlineOnly,
              };
              const lookup = await semanticLookup(input);
              // outlineOnly returns the compact text outline (the whole point is
              // minimal tokens); full mode keeps the structured object.
              result = outlineOnly
                ? formatLookupResult(lookup, true)
                : lookup;
            } else if (outlineOnly) {
              // Batch outline: one compact block per file, errors noted inline.
              const batch = await batchSemanticLookup(paths, projectDir);
              result = paths
                .map((p) => {
                  const r = batch.results.get(p);
                  if (r) return formatLookupResult(r, true);
                  const err = batch.errors.get(p);
                  return `${p} — error: ${err ? err.message : "not found"}`;
                })
                .join("\n\n");
            } else {
              // Batch full mode: BatchLookupResult holds Maps, which
              // JSON.stringify serializes to {} (and Error objects to {}), so
              // returning it raw produced silent empties. Flatten to plain
              // objects with string error messages — every requested path is
              // accounted for, explicitly.
              const batch = await batchSemanticLookup(paths, projectDir);
              const results: Record<string, SemanticLookupResult> = {};
              const errors: Record<string, string> = {};
              for (const p of paths) {
                const r = batch.results.get(p);
                if (r) {
                  results[p] = r;
                } else {
                  const err = batch.errors.get(p);
                  errors[p] = err ? err.message : "not found";
                }
              }
              result = { results, errors };
            }
            break;
          }

          case "impact_check": {
            const filePath = args.filePath as string;
            // Track file access for auto-learn
            recordFileAccess(projectDir, filePath, "impact_check");
            const input: ImpactCheckInput = {
              filePath,
              symbolName: args.symbolName as string | undefined,
              projectPath: projectDir,
            };
            result = await checkImpact(input);
            break;
          }

          case "symbol_context": {
            const filePath = args.filePath as string | undefined;
            // Track file access for auto-learn
            if (filePath) {
              recordFileAccess(projectDir, filePath, "symbol_context");
            }
            const input: SymbolContextInput = {
              symbolName: args.symbolName as string,
              filePath,
              projectPath: projectDir,
              signatureOnly: args.signatureOnly === true,
            };
            result = await getSymbolContext(input);
            break;
          }

          case "brain_search": {
            result = await brainSearch({
              query: args.query as string,
              projectPath: projectDir,
              sources: args.sources as
                | (
                    | "lessons"
                    | "file-insights"
                    | "conventions"
                    | "hot-files"
                    | "memories"
                  )[]
                | undefined,
            });
            break;
          }

          case "mistake_log": {
            result = await mistakeLog({
              mistake: args.mistake as string,
              projectPath: projectDir,
              severity: args.severity as "low" | "medium" | "high" | undefined,
              files: args.files as string[] | undefined,
            });
            break;
          }

          case "session_summary": {
            result = await sessionSummary({
              summary: args.summary as string,
              projectPath: projectDir,
              accomplishments: args.accomplishments as string[] | undefined,
              lessonsLearned: args.lessonsLearned as string[] | undefined,
            });
            break;
          }

          case "what_changed": {
            result = await whatChanged({
              filePath: args.filePath as string,
              projectPath: projectDir,
              since: args.since as string | undefined,
            });
            break;
          }

          case "puntax_context": {
            const input: PuntaxContextInput = {
              task: args.task as string,
              projectDir,
              sessionId: args.sessionId as string | undefined,
              mode: args.mode as PuntaxContextInput["mode"],
              files: args.files as string[] | undefined,
              symbols: args.symbols as string[] | undefined,
              budgetTokens: args.budgetTokens as number | undefined,
            };
            result = await puntaxContext(input);
            break;
          }

          case "session_checkpoint": {
            result = await sessionCheckpoint({
              projectPath: projectDir,
              sessionId: args.sessionId as string | undefined,
            });
            break;
          }

          case "refresh_index": {
            result = await refreshIndex({
              projectPath: projectDir,
              changedFiles: args.changedFiles as string[] | undefined,
              force: args.force as boolean | undefined,
            });
            break;
          }

          case "index_status": {
            result = await indexStatusTool({ projectPath: projectDir });
            break;
          }

          case "syntax_check": {
            const filePath = args.filePath as string;
            if (filePath) {
              recordFileAccess(projectDir, filePath, "syntax_check");
            }
            result = await syntaxCheckTool({
              filePath,
              content: args.content as string | undefined,
              projectPath: projectDir,
            });
            break;
          }

          case "code_map_outline": {
            result = await codeMapOutlineTool({
              projectPath: projectDir,
              dir: args.dir as string | undefined,
            });
            break;
          }

          case "memory_write": {
            result = memoryWrite({
              kind: args.kind as MemoryWriteInput["kind"],
              scope: args.scope as MemoryWriteInput["scope"],
              text: args.text as string,
              severity: args.severity as MemoryWriteInput["severity"],
              confidence: args.confidence as MemoryWriteInput["confidence"],
              source: args.source as MemoryWriteInput["source"],
              files: args.files as string[] | undefined,
              symbols: args.symbols as string[] | undefined,
              sourcePath: args.sourcePath as string | undefined,
              notes: args.notes as string | undefined,
              projectPath: (args.projectPath as string) ?? projectDir,
            });
            break;
          }

          case "mission_charter": {
            result = missionCharter({
              action: args.action as MissionCharterInput["action"],
              mission: args.mission as string | undefined,
              scope: args.scope as string[] | undefined,
              constraints: args.constraints as string[] | undefined,
              sessionId: args.sessionId as string | undefined,
              projectPath: (args.projectPath as string) ?? projectDir,
            });
            break;
          }

          case "refactor_manifest": {
            result = refactorManifest({
              action: args.action as RefactorManifestInput["action"],
              items: args.items as RefactorManifestInput["items"],
              ids: args.ids as string[] | undefined,
              reason: args.reason as string | undefined,
              projectPath: (args.projectPath as string) ?? projectDir,
            });
            break;
          }

          default:
            throw new Error(`Unknown tool: ${toolName}`);
        }

        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text:
                  typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2),
              },
            ],
          },
        };
      }

      case "notifications/initialized":
        // Acknowledge but no response needed for notifications
        return { jsonrpc: "2.0", id, result: null };

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
    }
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

// Main: Read JSON-RPC requests from stdin, write responses to stdout
async function main() {
  // Load tree-sitter grammars once so the code-map indexer parses TS/Python
  // from the real AST (not regex). Fail-open: a load failure leaves the indexer
  // on RegexBackend. Must run BEFORE createInterface starts reading stdin —
  // otherwise requests arriving during warmup are dropped by readline.
  await warmTreeSitter();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const request = JSON.parse(line) as MCPRequest;
      const response = await handleRequest(request);

      // Only send response for requests (not notifications)
      if (request.id !== undefined) {
        console.log(JSON.stringify(response));
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: "Parse error",
            data: error instanceof Error ? error.message : String(error),
          },
        }),
      );
    }
  }
}

// Only start the stdio loop when run as the executable entry point (the deploy
// runs `node dist/mcp-server.js`, compiled to CommonJS). Importing this module —
// e.g. from a test that drives handleRequest directly — must NOT read stdin.
if (require.main === module) {
  main().catch(console.error);
}
