/**
 * What Changed Tool
 *
 * Quick git diff analysis to see recent changes in a file.
 */

import { execSync } from 'child_process';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

export interface WhatChangedInput {
  filePath: string;
  projectPath: string;
  since?: string;  // e.g., "1 hour ago", "yesterday", "3 commits"
}

export interface ChangeInfo {
  filePath: string;
  hasUncommittedChanges: boolean;
  uncommittedDiff?: string;
  recentCommits: Array<{
    hash: string;
    author: string;
    date: string;
    message: string;
  }>;
  totalLinesChanged?: number;
}

// =============================================================================
// Implementation
// =============================================================================

export async function whatChanged(input: WhatChangedInput): Promise<ChangeInfo> {
  const { filePath, projectPath, since = '1 day ago' } = input;
  const absolutePath = path.resolve(projectPath, filePath);
  const relativePath = path.relative(projectPath, absolutePath);

  const result: ChangeInfo = {
    filePath: relativePath,
    hasUncommittedChanges: false,
    recentCommits: [],
  };

  try {
    // Check for uncommitted changes
    const uncommittedDiff = execSync(
      `git diff HEAD -- "${relativePath}"`,
      { cwd: projectPath, encoding: 'utf-8', maxBuffer: 1024 * 1024 }
    ).trim();

    if (uncommittedDiff) {
      result.hasUncommittedChanges = true;
      // Truncate long diffs
      result.uncommittedDiff = uncommittedDiff.length > 2000
        ? uncommittedDiff.slice(0, 2000) + '\n... (truncated)'
        : uncommittedDiff;
    }

    // Check staged changes too
    const stagedDiff = execSync(
      `git diff --cached -- "${relativePath}"`,
      { cwd: projectPath, encoding: 'utf-8', maxBuffer: 1024 * 1024 }
    ).trim();

    if (stagedDiff && !result.uncommittedDiff) {
      result.hasUncommittedChanges = true;
      result.uncommittedDiff = stagedDiff.length > 2000
        ? stagedDiff.slice(0, 2000) + '\n... (truncated)'
        : stagedDiff;
    }
  } catch {
    // No uncommitted changes or not in git
  }

  try {
    // Get recent commits for this file
    const logFormat = '--format=%H|%an|%ad|%s';
    const sinceArg = since.includes('commit') ? `-n ${parseInt(since)}` : `--since="${since}"`;

    const log = execSync(
      `git log ${sinceArg} ${logFormat} --date=short -- "${relativePath}"`,
      { cwd: projectPath, encoding: 'utf-8', maxBuffer: 1024 * 1024 }
    ).trim();

    if (log) {
      result.recentCommits = log.split('\n').slice(0, 10).map(line => {
        const [hash, author, date, ...messageParts] = line.split('|');
        return {
          hash: hash.slice(0, 7),
          author,
          date,
          message: messageParts.join('|'),
        };
      });
    }

    // Get total lines changed
    const stats = execSync(
      `git log ${sinceArg} --numstat --format="" -- "${relativePath}"`,
      { cwd: projectPath, encoding: 'utf-8', maxBuffer: 1024 * 1024 }
    ).trim();

    if (stats) {
      let totalLines = 0;
      for (const line of stats.split('\n')) {
        const parts = line.split('\t');
        if (parts.length >= 2) {
          const added = parseInt(parts[0]) || 0;
          const removed = parseInt(parts[1]) || 0;
          totalLines += added + removed;
        }
      }
      result.totalLinesChanged = totalLines;
    }
  } catch {
    // Git command failed - might not be a git repo or file not tracked
  }

  return result;
}

// =============================================================================
// Tool Definition
// =============================================================================

export const whatChangedToolDefinition = {
  name: 'what_changed',
  description: 'See what changed in a file recently. Shows uncommitted changes and recent git commits.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Path to the file to check',
      },
      projectDir: {
        type: 'string',
        description: 'Project root directory (defaults to cwd)',
      },
      since: {
        type: 'string',
        description: 'How far back to look (e.g., "1 hour ago", "yesterday", "5 commits"). Default: "1 day ago"',
      },
    },
    required: ['filePath'],
  },
};
