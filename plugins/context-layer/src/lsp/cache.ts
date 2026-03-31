/**
 * LSP Cache Module
 */

import * as crypto from 'crypto';

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  fileHash: string;
  filePath?: string;
}

export class LSPCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private defaultTimeout: number;
  private maxEntries: number;

  constructor(timeoutMs: number = 60000, maxEntries: number = 1000) {
    this.defaultTimeout = timeoutMs;
    this.maxEntries = maxEntries;
  }

  get<T>(key: string, currentFileHash?: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > this.defaultTimeout) {
      this.cache.delete(key);
      return null;
    }

    if (currentFileHash && entry.fileHash !== currentFileHash) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set<T>(key: string, data: T, fileHash: string, filePath?: string): void {
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      fileHash,
      filePath,
    });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidateForFile(filePath: string): void {
    const keysToDelete: string[] = [];
    for (const [key, entry] of this.cache.entries()) {
      if (entry.filePath === filePath || key.includes(filePath)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  private evictOldest(): void {
    const entriesToRemove = Math.max(1, Math.floor(this.maxEntries * 0.1));
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, entriesToRemove);

    for (const [key] of entries) {
      this.cache.delete(key);
    }
  }
}

export function generateCacheKey(
  operation: string,
  filePath: string,
  line: number,
  character: number
): string {
  return `${operation}:${filePath}:${line}:${character}`;
}

export function generateSymbolSearchCacheKey(
  operation: string,
  query: string,
  projectPath: string
): string {
  return `${operation}:${projectPath}:${query}`;
}

export function computeFileHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

let globalCache: LSPCache | null = null;

export function getGlobalCache(timeoutMs?: number, maxEntries?: number): LSPCache {
  if (!globalCache) {
    globalCache = new LSPCache(timeoutMs, maxEntries);
  }
  return globalCache;
}

export function resetGlobalCache(): void {
  globalCache = null;
}
