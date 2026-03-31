/**
 * Swarm Agent Module
 * 
 * Session-start hook that:
 * - Detects if project has .swarm/ coordination structure
 * - Reads current agent's tasks and messages
 * - Injects swarm status into session context
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const SWARM_DIR = '.swarm';
const BOARD_FILE = 'board.json';
const LOCKS_FILE = 'file-locks.json';

/**
 * Get unique agent ID for this session
 * Uses CLAUDE_SESSION_ID env var if available, otherwise generates from PID + timestamp
 */
function getAgentId() {
    // Check for explicit session ID first
    if (process.env.CLAUDE_SESSION_ID) {
        return process.env.CLAUDE_SESSION_ID;
    }
    
    // Check for parent PID to distinguish terminal sessions
    const ppid = process.ppid || process.pid;
    const hostname = os.hostname();
    const username = os.userInfo().username;
    
    // Include PPID to differentiate sessions on same machine
    return `${username}@${hostname}-${ppid}`;
}

/**
 * Check if project has swarm coordination enabled
 */
function hasSwarm(projectPath) {
    const swarmPath = path.join(projectPath, SWARM_DIR);
    const boardPath = path.join(swarmPath, BOARD_FILE);
    return fs.existsSync(boardPath);
}

/**
 * Load swarm board
 */
function loadBoard(projectPath) {
    const boardPath = path.join(projectPath, SWARM_DIR, BOARD_FILE);
    if (!fs.existsSync(boardPath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(boardPath, 'utf-8'));
    } catch (e) {
        console.error('[swarm-agent] Failed to load board:', e);
        return null;
    }
}

/**
 * Load file locks
 */
function loadLocks(projectPath) {
    const locksPath = path.join(projectPath, SWARM_DIR, LOCKS_FILE);
    if (!fs.existsSync(locksPath)) {
        return { locks: {}, expired_after_hours: 8 };
    }
    try {
        return JSON.parse(fs.readFileSync(locksPath, 'utf-8'));
    } catch (e) {
        console.error('[swarm-agent] Failed to load locks:', e);
        return { locks: {}, expired_after_hours: 8 };
    }
}

/**
 * Check for messages in .swarm/messages/<agentId>
 */
function checkMessages(projectPath, agentId) {
    const messagesPath = path.join(projectPath, SWARM_DIR, 'messages', agentId);
    if (!fs.existsSync(messagesPath)) {
        return [];
    }
    
    const files = fs.readdirSync(messagesPath).filter(f => f.endsWith('.json'));
    return files.map(f => {
        try {
            return JSON.parse(fs.readFileSync(path.join(messagesPath, f), 'utf-8'));
        } catch (e) {
            return null;
        }
    }).filter(m => m !== null);
}

/**
 * Generate swarm context to inject at session start
 */
function generateSwarmContext(projectPath, agentId) {
    const board = loadBoard(projectPath);
    if (!board) {
        return null;
    }

    const locks = loadLocks(projectPath);
    const messages = checkMessages(projectPath, agentId);

    // Find my active tasks
    const myTasks = board.tasks.in_progress.filter(t => t.assignee === agentId);

    // Find OTHER agents' active tasks
    const otherAgentTasks = board.tasks.in_progress.filter(t => t.assignee !== agentId);

    // Find tasks in review by me
    const myReviewTasks = board.tasks.review.filter(t => t.assignee === agentId);

    // Get ready tasks
    const readyTasks = board.tasks.ready || [];

    // Check for unread messages
    const unreadMessages = messages.filter(m => m.status === 'pending');

    // Get locked files
    const lockedFilesList = Object.entries(locks.locks || {});

    // Build context string
    let context = `# ⚠️ SWARM COORDINATION ACTIVE\n\n`;
    context += `**Your Agent ID**: \`${agentId}\`\n`;
    context += `**Project**: ${board.project}\n\n`;

    // CRITICAL: Show what's already being worked on
    if (otherAgentTasks.length > 0) {
        context += `## 🚫 TASKS ALREADY CLAIMED (DO NOT WORK ON THESE)\n`;
        otherAgentTasks.forEach(task => {
            const taskFiles = task.files || [];
            context += `- **${task.id}**: ${task.title}\n`;
            context += `  - Claimed by: \`${task.assignee}\`\n`;
            context += `  - Files LOCKED: ${taskFiles.join(', ') || 'none listed'}\n`;
        });
        context += `\n`;
    }

    // Show YOUR active tasks
    if (myTasks.length > 0) {
        context += `## ✅ YOUR ACTIVE TASKS (Continue Working)\n`;
        myTasks.forEach(task => {
            const taskFiles = task.files || [];
            context += `- **${task.id}**: ${task.title}\n`;
            context += `  - Files: ${taskFiles.join(', ') || 'none'}\n`;
            context += `  - Started: ${new Date(task.started_at).toLocaleString()}\n`;
        });
        context += `\n`;
    }

    // Show AVAILABLE tasks (these can be claimed)
    context += `## 📋 AVAILABLE TASKS (Can Claim)\n`;
    if (readyTasks.length > 0) {
        readyTasks.slice(0, 10).forEach(task => {
            context += `- **${task.id}**: ${task.title}\n`;
        });
        if (readyTasks.length > 10) {
            context += `- ... and ${readyTasks.length - 10} more\n`;
        }
    } else {
        context += `- No tasks available to claim\n`;
    }
    context += `\n`;

    // Show locked files
    if (lockedFilesList.length > 0) {
        context += `## 🔒 LOCKED FILES (Cannot Edit)\n`;
        lockedFilesList.slice(0, 10).forEach(([file, lock]) => {
            context += `- \`${file}\` → locked by \`${lock.agent}\`\n`;
        });
        if (lockedFilesList.length > 10) {
            context += `- ... and ${lockedFilesList.length - 10} more\n`;
        }
        context += `\n`;
    }

    if (myReviewTasks.length > 0) {
        context += `## 👀 Your Tasks in Review\n`;
        myReviewTasks.forEach(task => {
            context += `- **${task.id}**: ${task.title}\n`;
        });
        context += `\n`;
    }

    if (unreadMessages.length > 0) {
        context += `## 📬 Unread Messages (${unreadMessages.length})\n`;
        unreadMessages.slice(0, 5).forEach(msg => {
            context += `- **From ${msg.from}** (${msg.type})\n`;
        });
        context += `\n`;
    }

    // Summary stats
    context += `## Summary\n`;
    context += `- Ready: ${readyTasks.length} | In Progress: ${board.tasks.in_progress.length} | Review: ${(board.tasks.review || []).length} | Done: ${(board.tasks.done || []).length}\n\n`;

    // CRITICAL INSTRUCTIONS
    context += `## ⚠️ IMPORTANT RULES\n`;
    context += `1. **ONLY work on tasks from "AVAILABLE TASKS" or "YOUR ACTIVE TASKS"**\n`;
    context += `2. **DO NOT touch files listed in "LOCKED FILES"**\n`;
    context += `3. **Use \`swarm_claim_task\` before starting ANY new task**\n`;
    context += `4. **Use \`swarm_complete_task\` when done**\n\n`;

    context += `**To claim a task**: \`swarm_claim_task\` with taskId and your agentId\n`;

    return context;
}

/**
 * Swarm agent hook for session start
 * Called by session-start module
 */
export async function checkSwarm(projectPath) {
    // Check if swarm is enabled
    if (!hasSwarm(projectPath)) {
        return null;
    }

    const agentId = getAgentId();
    const swarmContext = generateSwarmContext(projectPath, agentId);

    return swarmContext;
}
