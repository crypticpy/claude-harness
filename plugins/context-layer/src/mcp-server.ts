#!/usr/bin/env node
/**
 * MCP Server for Context Layer Tools
 *
 * Exposes semantic_lookup, impact_check, symbol_context, and chunk_ref as MCP tools.
 */

import * as readline from 'readline';
import {
  semanticLookup,
  batchSemanticLookup,
  checkImpact,
  getSymbolContext,
  getChunkRef,
  extractAndCacheChunk,
  brainSearch,
  mistakeLog,
  sessionSummary,
  whatChanged,
  brainToolDefinitions,
  whatChangedToolDefinition,
  swarmInit,
  swarmQueryBoard,
  swarmClaimTask,
  swarmCompleteTask,
  swarmSendMessage,
  swarmReadMessages,
  swarmLogDecision,
  swarmToolDefinitions,
  type SemanticLookupInput,
  type ImpactCheckInput,
  type SymbolContextInput,
  type ChunkRefInput,
} from './tools';
import { recordFileAccess } from './learn';

interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
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
    name: 'semantic_lookup',
    description: 'Get file summaries and metadata before reading full content. Use this to understand what a file contains without consuming context reading the whole thing.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths to look up (relative or absolute)',
        },
        projectDir: {
          type: 'string',
          description: 'Project root directory (defaults to cwd)',
        },
      },
      required: ['paths'],
    },
  },
  {
    name: 'impact_check',
    description: 'Check what would break if you modify a file or symbol. Returns dependents, callers, and risk assessment.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file being modified',
        },
        symbolName: {
          type: 'string',
          description: 'Optional: specific symbol being modified (function, class, etc.)',
        },
        changeType: {
          type: 'string',
          enum: ['modify', 'delete', 'rename'],
          description: 'Type of change being made',
        },
        projectDir: {
          type: 'string',
          description: 'Project root directory (defaults to cwd)',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'symbol_context',
    description: 'Get type information, documentation, and related symbols for any code symbol without reading the entire file.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file containing the symbol',
        },
        symbolName: {
          type: 'string',
          description: 'Name of the symbol to look up',
        },
        line: {
          type: 'number',
          description: 'Optional: line number where symbol appears',
        },
        projectDir: {
          type: 'string',
          description: 'Project root directory (defaults to cwd)',
        },
      },
      required: ['filePath', 'symbolName'],
    },
  },
  {
    name: 'chunk_ref',
    description: 'Reference a code chunk that was previously read. Use chunk IDs from earlier tool results to avoid re-reading code.',
    inputSchema: {
      type: 'object',
      properties: {
        chunkId: {
          type: 'string',
          description: 'ID of a previously cached chunk (from semantic_lookup or symbol_context results)',
        },
        filePath: {
          type: 'string',
          description: 'Alternative: file path to get chunk from',
        },
        symbolName: {
          type: 'string',
          description: 'Alternative: symbol name to extract as chunk',
        },
        startLine: {
          type: 'number',
          description: 'Alternative: start line for range-based chunk',
        },
        endLine: {
          type: 'number',
          description: 'Alternative: end line for range-based chunk',
        },
      },
    },
  },
  // Brain tools
  ...brainToolDefinitions,
  // What changed tool
  whatChangedToolDefinition,
  // Swarm coordination tools
  ...swarmToolDefinitions,
];

async function handleRequest(request: MCPRequest): Promise<MCPResponse> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'context-layer',
              version: '0.1.0',
            },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: TOOLS },
        };

      case 'tools/call': {
        const toolName = (params as { name: string })?.name;
        const args = (params as { arguments: Record<string, unknown> })?.arguments || {};
        const projectDir = (args.projectDir as string) || process.cwd();
        const sessionId = (args.sessionId as string) || 'mcp-session';

        let result: unknown;

        switch (toolName) {
          case 'semantic_lookup': {
            const paths = args.paths as string[];
            // Track file accesses for auto-learn
            for (const p of paths) {
              recordFileAccess(projectDir, p, 'semantic_lookup');
            }
            if (paths.length === 1) {
              const input: SemanticLookupInput = {
                filePath: paths[0],
                projectPath: projectDir,
              };
              result = await semanticLookup(input);
            } else {
              result = await batchSemanticLookup(paths, projectDir);
            }
            break;
          }

          case 'impact_check': {
            const filePath = args.filePath as string;
            // Track file access for auto-learn
            recordFileAccess(projectDir, filePath, 'impact_check');
            const input: ImpactCheckInput = {
              filePath,
              symbolName: args.symbolName as string | undefined,
              projectPath: projectDir,
            };
            result = await checkImpact(input);
            break;
          }

          case 'symbol_context': {
            const filePath = args.filePath as string | undefined;
            // Track file access for auto-learn
            if (filePath) {
              recordFileAccess(projectDir, filePath, 'symbol_context');
            }
            const input: SymbolContextInput = {
              symbolName: args.symbolName as string,
              filePath,
              projectPath: projectDir,
            };
            result = await getSymbolContext(input);
            break;
          }

          case 'chunk_ref': {
            if (args.chunkId) {
              const input: ChunkRefInput = {
                chunkId: args.chunkId as string,
                sessionId,
              };
              result = await getChunkRef(input);
            } else if (args.filePath && args.symbolName) {
              // Track file access for auto-learn
              recordFileAccess(projectDir, args.filePath as string, 'chunk_ref');
              // Extract and cache a new chunk
              result = await extractAndCacheChunk(
                args.filePath as string,
                args.symbolName as string,
                sessionId
              );
            } else {
              throw new Error('Either chunkId or (filePath + symbolName) required');
            }
            break;
          }

          case 'brain_search': {
            result = await brainSearch({
              query: args.query as string,
              projectPath: projectDir,
              sources: args.sources as ('lessons' | 'file-insights' | 'conventions' | 'hot-files')[] | undefined,
            });
            break;
          }

          case 'mistake_log': {
            result = await mistakeLog({
              mistake: args.mistake as string,
              projectPath: projectDir,
              severity: args.severity as 'low' | 'medium' | 'high' | undefined,
              files: args.files as string[] | undefined,
            });
            break;
          }

          case 'session_summary': {
            result = await sessionSummary({
              summary: args.summary as string,
              projectPath: projectDir,
              accomplishments: args.accomplishments as string[] | undefined,
              lessonsLearned: args.lessonsLearned as string[] | undefined,
            });
            break;
          }

          case 'what_changed': {
            result = await whatChanged({
              filePath: args.filePath as string,
              projectPath: projectDir,
              since: args.since as string | undefined,
            });
            break;
          }

          case 'swarm_init': {
            result = await swarmInit({
              projectPath: args.projectPath as string || projectDir,
              projectName: args.projectName as string,
            });
            break;
          }

          case 'swarm_query_board': {
            result = await swarmQueryBoard({
              projectPath: args.projectPath as string || projectDir,
              agentId: args.agentId as string,
              agentSkills: args.agentSkills as string[],
              status: args.status as 'backlog' | 'ready' | 'in_progress' | 'review' | 'done' | undefined,
            });
            break;
          }

          case 'swarm_claim_task': {
            result = await swarmClaimTask({
              projectPath: args.projectPath as string || projectDir,
              taskId: args.taskId as string,
              agentId: args.agentId as string,
            });
            break;
          }

          case 'swarm_complete_task': {
            result = await swarmCompleteTask({
              projectPath: args.projectPath as string || projectDir,
              taskId: args.taskId as string,
              agentId: args.agentId as string,
              prUrl: args.prUrl as string | undefined,
            });
            break;
          }

          case 'swarm_send_message': {
            result = await swarmSendMessage({
              projectPath: args.projectPath as string || projectDir,
              from: args.from as string,
              to: args.to as string,
              type: args.type as string,
              content: args.content as any,
            });
            break;
          }

          case 'swarm_read_messages': {
            result = await swarmReadMessages({
              projectPath: args.projectPath as string || projectDir,
              agentId: args.agentId as string,
              unreadOnly: args.unreadOnly as boolean | undefined,
            });
            break;
          }

          case 'swarm_log_decision': {
            result = await swarmLogDecision({
              projectPath: args.projectPath as string || projectDir,
              agentId: args.agentId as string,
              decision: args.decision as string,
              context: args.context as string | undefined,
              rationale: args.rationale as string | undefined,
            });
            break;
          }

          default:
            throw new Error(`Unknown tool: ${toolName}`);
        }

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
              },
            ],
          },
        };
      }

      case 'notifications/initialized':
        // Acknowledge but no response needed for notifications
        return { jsonrpc: '2.0', id, result: null };

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
    }
  } catch (error) {
    return {
      jsonrpc: '2.0',
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
      console.error(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
          data: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  }
}

main().catch(console.error);
