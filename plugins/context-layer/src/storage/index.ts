/**
 * Context Layer Storage Module
 */

export type {
  ContextStorage,
  ProjectProfile,
  FileIndexEntry,
  ContextRead,
  CodeChunk,
  StorageOptions,
  BulkOperationResult,
} from './interface';

export { SQLiteStorage } from './sqlite';

import { SQLiteStorage } from './sqlite';
import type { ContextStorage, StorageOptions } from './interface';
import * as path from 'path';

export const DEFAULT_DB_PATH = path.join(
  process.env.HOME || '~',
  '.claude',
  'plugins',
  'context-layer',
  'data',
  'context.db'
);

export function createStorage(
  dbPath?: string,
  options?: Omit<StorageOptions, 'dbPath'>
): ContextStorage {
  return new SQLiteStorage({
    dbPath: dbPath || DEFAULT_DB_PATH,
    ...options,
  });
}

export function createTestStorage(
  options?: Omit<StorageOptions, 'dbPath'>
): ContextStorage {
  return new SQLiteStorage({
    dbPath: ':memory:',
    ...options,
  });
}

export function generateFileIndexId(projectId: string, filePath: string): string {
  return `${projectId}:${filePath}`;
}

export function generateChunkId(filePath: string, symbolName: string): string {
  return `${filePath}:${symbolName}`;
}

export function generateReadId(
  sessionId: string,
  filePath: string,
  timestamp: number = Date.now()
): string {
  return `${sessionId}:${filePath}:${timestamp}`;
}

export function computeProjectHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
