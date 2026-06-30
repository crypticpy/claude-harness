#!/usr/bin/env node
/**
 * MCP Server for Context Layer Tools
 *
 * Exposes semantic_lookup, impact_check, symbol_context, and chunk_ref as MCP tools.
 */

import * as readline from "readline";
import {
  semanticLookup,
  batchSemanticLookup,
  formatLookupResult,
  checkImpact,
  getSymbolContext,
  getChunkRef,
  extractAndCacheChunk,
  extractChunksBatch,
  brainSearch,
  mistakeLog,
  sessionSummary,
  whatChanged,
  puntaxContext,
  sessionCheckpoint,
  refreshIndex,
  indexStatusTool,
  memoryWrite,
  brainToolDefinitions,
  whatChangedToolDefinition,
  puntaxContextToolDefinition,
  sessionCheckpointToolDefinition,
  refreshIndexToolDefinition,
  indexStatusToolDefinition,
  memoryWriteToolDefinition,
  type SemanticLookupInput,
  type ImpactCheckInput,
  type SymbolContextInput,
  type ChunkRefInput,
  type PuntaxContextInput,
  type MemoryWriteInput,
} from "./tools";
import { recordFileAccess } from "./learn";
import { shutdownLsp } from "./lsp/lsp-service";

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
  {
    name: "chunk_ref",
    description:
      "Reference a code chunk that was previously read. Use chunk IDs from earlier tool results to avoid re-reading code.",
    inputSchema: {
      type: "object",
      properties: {
        chunkId: {
          type: "string",
          description:
            "ID of a previously cached chunk (from semantic_lookup or symbol_context results)",
        },
        filePath: {
          type: "string",
          description: "Alternative: file path to get chunk from",
        },
        symbolName: {
          type: "string",
          description: "Alternative: symbol name to extract as chunk",
        },
        symbolNames: {
          type: "array",
          items: { type: "string" },
          description:
            "Batch: with filePath, extract many symbols in one read+parse. " +
            "Returns { filePath, chunks: [{ symbolName, content, found }] }.",
        },
        startLine: {
          type: "number",
          description: "Alternative: start line for range-based chunk",
        },
        endLine: {
          type: "number",
          description: "Alternative: end line for range-based chunk",
        },
      },
    },
  },
  // PUNTAX context router (primary tool)
  puntaxContextToolDefinition,
  // Deterministic session checkpoint
  sessionCheckpointToolDefinition,
  // Code-map index tools
  refreshIndexToolDefinition,
  indexStatusToolDefinition,
  // Typed memory write
  memoryWriteToolDefinition,
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
        const sessionId = (args.sessionId as string) || "mcp-session";

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
              result = await batchSemanticLookup(paths, projectDir);
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

          case "chunk_ref": {
            if (
              args.filePath &&
              Array.isArray(args.symbolNames) &&
              args.symbolNames.length > 0
            ) {
              // Batch: one read + parse for many symbols in the same file.
              const filePath = args.filePath as string;
              recordFileAccess(projectDir, filePath, "chunk_ref");
              const names = (args.symbolNames as unknown[]).filter(
                (s): s is string => typeof s === "string",
              );
              result = { filePath, chunks: await extractChunksBatch(filePath, names) };
            } else if (args.chunkId) {
              const input: ChunkRefInput = {
                chunkId: args.chunkId as string,
                sessionId,
              };
              result = await getChunkRef(input);
            } else if (args.filePath && args.symbolName) {
              // Track file access for auto-learn
              recordFileAccess(
                projectDir,
                args.filePath as string,
                "chunk_ref",
              );
              // Extract and cache a new chunk
              result = await extractAndCacheChunk(
                args.filePath as string,
                args.symbolName as string,
                sessionId,
              );
            } else {
              throw new Error(
                "Either chunkId or (filePath + symbolName) required",
              );
            }
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
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Tear down any spawned language servers on signal-driven exit. Stdin EOF is
  // handled after the loop below; these cover Ctrl-C / kill.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      void shutdownLsp().finally(() => process.exit(0));
    });
  }

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

  // Stdin closed (client disconnected): stop language servers before exit.
  await shutdownLsp();
}

// Only start the stdio loop when run as the executable entry point (the deploy
// runs `node dist/mcp-server.js`, compiled to CommonJS). Importing this module —
// e.g. from a test that drives handleRequest directly — must NOT read stdin.
if (require.main === module) {
  main().catch(console.error);
}
