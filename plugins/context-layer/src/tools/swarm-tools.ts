/**
 * Swarm Coordination Tools
 * 
 * MCP tools for decentralized multi-agent coordination via Git-based task board
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

/**
 * Generate a unique agent ID
 * If agentId is provided and looks like a full ID, use it
 * Otherwise, generate one from machine info
 */
export function resolveAgentId(providedId?: string): string {
    if (providedId && providedId.includes('@')) {
        return providedId;
    }
    
    // Generate from environment
    const hostname = os.hostname();
    const username = os.userInfo().username;
    const sessionId = process.env.CLAUDE_SESSION_ID || process.ppid || process.pid;
    
    return `${username}@${hostname}-${sessionId}`;
}

interface Task {
    id: string;
    phase: string;
    title: string;
    description: string;
    skills: string[];
    files: string[];
    deliverables: string[];
    depends_on: string[];
    estimated_hours: number;
    priority: number;
    assignee?: string;
    started_at?: string;
    completed_at?: string;
    pr_branch?: string;
}

interface Board {
    project: string;
    created: string;
    phases: Array<{
        id: string;
        name: string;
        order: number;
        status: string;
        blocked_by?: string[];
    }>;
    tasks: {
        backlog: Task[];
        ready: Task[];
        in_progress: Task[];
        review: Task[];
        done: Task[];
    };
}

interface FileLocks {
    locks: {
        [filePath: string]: {
            task: string;
            agent: string;
            locked_at: string;
            reason: string;
        };
    };
    expired_after_hours: number;
}

const SWARM_DIR = '.swarm';
const BOARD_FILE = 'board.json';
const LOCKS_FILE = 'file-locks.json';
const MESSAGES_DIR = 'messages';
const DECISIONS_FILE = 'decisions.jsonl';

function getSwarmPath(projectPath: string): string {
    return path.join(projectPath, SWARM_DIR);
}

function getBoardPath(projectPath: string): string {
    return path.join(getSwarmPath(projectPath), BOARD_FILE);
}

function getLocksPath(projectPath: string): string {
    return path.join(getSwarmPath(projectPath), LOCKS_FILE);
}

function loadBoard(projectPath: string): Board {
    const boardPath = getBoardPath(projectPath);
    if (!fs.existsSync(boardPath)) {
        throw new Error(`No task board found at ${boardPath}. Run swarm_init first.`);
    }
    return JSON.parse(fs.readFileSync(boardPath, 'utf-8'));
}

function saveBoard(projectPath: string, board: Board): void {
    const boardPath = getBoardPath(projectPath);
    fs.writeFileSync(boardPath, JSON.stringify(board, null, 2));
}

function loadLocks(projectPath: string): FileLocks {
    const locksPath = getLocksPath(projectPath);
    if (!fs.existsSync(locksPath)) {
        return { locks: {}, expired_after_hours: 8 };
    }
    return JSON.parse(fs.readFileSync(locksPath, 'utf-8'));
}

function saveLocks(projectPath: string, locks: FileLocks): void {
    const locksPath = getLocksPath(projectPath);
    fs.writeFileSync(locksPath, JSON.stringify(locks, null, 2));
}

function gitCommit(projectPath: string, message: string): void {
    try {
        // argv form (no shell): a commit `message` cannot inject a command.
        execFileSync('git', ['add', SWARM_DIR], { cwd: projectPath });
        execFileSync('git', ['commit', '-m', message, '--no-verify'], { cwd: projectPath });
    } catch (e) {
        // Ignore if nothing to commit
    }
}

/**
 * Initialize swarm coordination structure
 */
export async function swarmInit(input: {
    projectPath: string;
    projectName: string;
}): Promise<{ success: boolean; message: string }> {
    const { projectPath, projectName } = input;
    const swarmPath = getSwarmPath(projectPath);

    // Create directories
    if (!fs.existsSync(swarmPath)) {
        fs.mkdirSync(swarmPath, { recursive: true });
    }
    
    const messagesPath = path.join(swarmPath, MESSAGES_DIR);
    if (!fs.existsSync(messagesPath)) {
        fs.mkdirSync(messagesPath, { recursive: true });
    }

    const agentsPath = path.join(swarmPath, 'agents');
    if (!fs.existsSync(agentsPath)) {
        fs.mkdirSync(agentsPath, { recursive: true });
    }

    // Create initial board
    const board: Board = {
        project: projectName,
        created: new Date().toISOString(),
        phases: [],
        tasks: {
            backlog: [],
            ready: [],
            in_progress: [],
            review: [],
            done: []
        }
    };

    saveBoard(projectPath, board);

    // Create initial locks file
    saveLocks(projectPath, { locks: {}, expired_after_hours: 8 });

    // Create decisions log
    const decisionsPath = path.join(swarmPath, DECISIONS_FILE);
    if (!fs.existsSync(decisionsPath)) {
        fs.writeFileSync(decisionsPath, '');
    }

    // Git commit
    gitCommit(projectPath, 'swarm: initialize coordination structure');

    return {
        success: true,
        message: `Swarm initialized for ${projectName}. Edit ${BOARD_FILE} to add tasks.`
    };
}

/**
 * Query available tasks
 */
export async function swarmQueryBoard(input: {
    projectPath: string;
    agentId: string;
    agentSkills: string[];
    status?: 'backlog' | 'ready' | 'in_progress' | 'review' | 'done';
}): Promise<{
    myTasks: Task[];
    availableTasks: Task[];
    totalTasks: { [key: string]: number };
}> {
    const { projectPath, agentId, agentSkills, status } = input;
    const board = loadBoard(projectPath);

    // Tasks assigned to me
    const myTasks = board.tasks.in_progress.filter(t => t.assignee === agentId);

    // Tasks I can grab (in ready, matching skills)
    const availableTasks = board.tasks.ready
        .filter(t => {
            const taskSkills = t.skills || [];
            return agentSkills.length === 0 || taskSkills.some(s => agentSkills.includes(s));
        })
        .sort((a, b) => {
            // Handle priority as string or number
            const aPri = typeof a.priority === 'string' ? 999 : a.priority;
            const bPri = typeof b.priority === 'string' ? 999 : b.priority;
            return aPri - bPri;
        });

    // Stats
    const totalTasks = {
        backlog: board.tasks.backlog.length,
        ready: board.tasks.ready.length,
        in_progress: board.tasks.in_progress.length,
        review: board.tasks.review.length,
        done: board.tasks.done.length
    };

    return {
        myTasks,
        availableTasks: status ? (status === 'ready' ? availableTasks : []) : availableTasks.slice(0, 10),
        totalTasks
    };
}

/**
 * Claim a task
 */
export async function swarmClaimTask(input: {
    projectPath: string;
    taskId: string;
    agentId: string;
}): Promise<{ success: boolean; message: string; task?: Task }> {
    const { projectPath, taskId, agentId } = input;
    const board = loadBoard(projectPath);
    const locks = loadLocks(projectPath);

    // Find task in ready
    const taskIndex = board.tasks.ready.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
        return { success: false, message: `Task ${taskId} not in ready state` };
    }

    const task = board.tasks.ready[taskIndex];

    // Check dependencies (handle both depends_on and dependencies fields)
    const deps = (task.depends_on || (task as any).dependencies || []);
    const unmetDeps = deps.filter(
        (depId: string) => !board.tasks.done.some(t => t.id === depId)
    );
    if (unmetDeps.length > 0) {
        return {
            success: false,
            message: `Dependencies not met: ${unmetDeps.join(', ')}`
        };
    }

    // Check file locks (if files are specified)
    const taskFiles = task.files || [];
    const lockedFiles = taskFiles.filter(
        f => locks.locks[f] && locks.locks[f].agent !== agentId
    );
    if (lockedFiles.length > 0) {
        return {
            success: false,
            message: `Files locked by another agent: ${lockedFiles.join(', ')}`
        };
    }

    // Claim task
    task.assignee = agentId;
    task.started_at = new Date().toISOString();
    
    // Move to in_progress
    board.tasks.ready.splice(taskIndex, 1);
    board.tasks.in_progress.push(task);

    // Lock files (if any)
    const files = task.files || [];
    files.forEach(f => {
        locks.locks[f] = {
            task: task.id,
            agent: agentId,
            locked_at: new Date().toISOString(),
            reason: task.title
        };
    });

    // Save
    saveBoard(projectPath, board);
    saveLocks(projectPath, locks);
    gitCommit(projectPath, `swarm: ${agentId} claimed ${taskId}`);

    return {
        success: true,
        message: `Claimed task: ${task.title}`,
        task
    };
}

/**
 * Complete a task (move to review)
 */
export async function swarmCompleteTask(input: {
    projectPath: string;
    taskId: string;
    agentId: string;
    prUrl?: string;
}): Promise<{ success: boolean; message: string; unlockedTasks?: string[] }> {
    const { projectPath, taskId, agentId, prUrl } = input;
    const board = loadBoard(projectPath);
    const locks = loadLocks(projectPath);

    // Find task
    const taskIndex = board.tasks.in_progress.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
        return { success: false, message: `Task ${taskId} not in progress` };
    }

    const task = board.tasks.in_progress[taskIndex];
    if (task.assignee !== agentId) {
        return { success: false, message: `Task ${taskId} assigned to ${task.assignee}, not you` };
    }

    // Move to review
    task.completed_at = new Date().toISOString();
    if (prUrl) task.pr_branch = prUrl;
    
    board.tasks.in_progress.splice(taskIndex, 1);
    board.tasks.review.push(task);

    // Unlock files (if any)
    const files = task.files || [];
    files.forEach(f => delete locks.locks[f]);

    // Check for tasks that can now move from backlog to ready
    const unlockedTasks: string[] = [];
    board.tasks.backlog = board.tasks.backlog.filter(t => {
        const deps = (t.depends_on || (t as any).dependencies || []);
        const allDeps = deps.every(
            (depId: string) => board.tasks.review.some(x => x.id === depId) ||
                     board.tasks.done.some(x => x.id === depId)
        );
        if (allDeps) {
            board.tasks.ready.push(t);
            unlockedTasks.push(t.id);
            return false;
        }
        return true;
    });

    // Save
    saveBoard(projectPath, board);
    saveLocks(projectPath, locks);
    gitCommit(projectPath, `swarm: ${agentId} completed ${taskId}`);

    return {
        success: true,
        message: `Task ${task.title} moved to review`,
        unlockedTasks
    };
}

/**
 * Send a message to another agent
 */
export async function swarmSendMessage(input: {
    projectPath: string;
    from: string;
    to: string; // agent ID or "broadcast"
    type: string;
    content: any;
}): Promise<{ success: boolean; messageId: string }> {
    const { projectPath, from, to, type, content } = input;
    
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const message = {
        id: messageId,
        from,
        to,
        timestamp: new Date().toISOString(),
        type,
        content,
        status: 'pending'
    };

    const messagesPath = path.join(getSwarmPath(projectPath), MESSAGES_DIR);
    const targetDir = path.join(messagesPath, to);
    
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const messagePath = path.join(targetDir, `${messageId}.json`);
    fs.writeFileSync(messagePath, JSON.stringify(message, null, 2));

    gitCommit(projectPath, `swarm: message ${from} → ${to}`);

    return { success: true, messageId };
}

/**
 * Read messages for an agent
 */
export async function swarmReadMessages(input: {
    projectPath: string;
    agentId: string;
    unreadOnly?: boolean;
}): Promise<{ messages: any[]; count: number }> {
    const { projectPath, agentId } = input;
    
    const messagesPath = path.join(getSwarmPath(projectPath), MESSAGES_DIR, agentId);
    
    if (!fs.existsSync(messagesPath)) {
        return { messages: [], count: 0 };
    }

    const files = fs.readdirSync(messagesPath).filter(f => f.endsWith('.json'));
    const messages = files.map(f => {
        return JSON.parse(fs.readFileSync(path.join(messagesPath, f), 'utf-8'));
    });

    // Sort by timestamp
    messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return {
        messages,
        count: messages.length
    };
}

/**
 * Log a decision
 */
export async function swarmLogDecision(input: {
    projectPath: string;
    agentId: string;
    decision: string;
    context?: string;
    rationale?: string;
}): Promise<{ success: boolean }> {
    const { projectPath, agentId, decision, context, rationale } = input;
    
    const decisionsPath = path.join(getSwarmPath(projectPath), DECISIONS_FILE);
    const entry = {
        timestamp: new Date().toISOString(),
        agent: agentId,
        decision,
        context,
        rationale,
        consensus: false
    };

    fs.appendFileSync(decisionsPath, JSON.stringify(entry) + '\n');
    gitCommit(projectPath, `swarm: decision by ${agentId}`);

    return { success: true };
}

// Export tool definitions for MCP
export const swarmToolDefinitions = [
    {
        name: 'swarm_init',
        description: 'Initialize swarm coordination structure in project. Creates .swarm/ directory with board, locks, and message system.',
        inputSchema: {
            type: 'object',
            properties: {
                projectPath: { type: 'string', description: 'Path to project root' },
                projectName: { type: 'string', description: 'Name of the project' }
            },
            required: ['projectPath', 'projectName']
        }
    },
    {
        name: 'swarm_query_board',
        description: 'Query the task board to see available tasks and your current assignments.',
        inputSchema: {
            type: 'object',
            properties: {
                projectPath: { type: 'string', description: 'Path to project root' },
                agentId: { type: 'string', description: 'Your agent ID' },
                agentSkills: { type: 'array', items: { type: 'string' }, description: 'Your skills (e.g. ["frontend", "react"])' },
                status: { type: 'string', enum: ['backlog', 'ready', 'in_progress', 'review', 'done'] }
            },
            required: ['projectPath', 'agentId', 'agentSkills']
        }
    },
    {
        name: 'swarm_claim_task',
        description: 'Claim a task from the ready column. This locks the files and moves task to in_progress.',
        inputSchema: {
            type: 'object',
            properties: {
                projectPath: { type: 'string' },
                taskId: { type: 'string', description: 'Task ID from board' },
                agentId: { type: 'string', description: 'Your agent ID' }
            },
            required: ['projectPath', 'taskId', 'agentId']
        }
    },
    {
        name: 'swarm_complete_task',
        description: 'Mark task as complete and move to review. Unlocks files and unblocks dependent tasks.',
        inputSchema: {
            type: 'object',
            properties: {
                projectPath: { type: 'string' },
                taskId: { type: 'string' },
                agentId: { type: 'string' },
                prUrl: { type: 'string', description: 'Optional PR URL' }
            },
            required: ['projectPath', 'taskId', 'agentId']
        }
    },
    {
        name: 'swarm_send_message',
        description: 'Send a message to another agent or broadcast to all agents.',
        inputSchema: {
            type: 'object',
            properties: {
                projectPath: { type: 'string' },
                from: { type: 'string', description: 'Your agent ID' },
                to: { type: 'string', description: 'Target agent ID or "broadcast"' },
                type: { type: 'string', description: 'Message type (e.g. "api_contract_request")' },
                content: { type: 'object', description: 'Message payload' }
            },
            required: ['projectPath', 'from', 'to', 'type', 'content']
        }
    },
    {
        name: 'swarm_read_messages',
        description: 'Read messages sent to you by other agents.',
        inputSchema: {
            type: 'object',
            properties: {
                projectPath: { type: 'string' },
                agentId: { type: 'string' },
                unreadOnly: { type: 'boolean' }
            },
            required: ['projectPath', 'agentId']
        }
    },
    {
        name: 'swarm_log_decision',
        description: 'Log an architectural or technical decision for team visibility and consensus.',
        inputSchema: {
            type: 'object',
            properties: {
                projectPath: { type: 'string' },
                agentId: { type: 'string' },
                decision: { type: 'string', description: 'The decision made' },
                context: { type: 'string', description: 'Context (task ID, etc.)' },
                rationale: { type: 'string', description: 'Why this decision' }
            },
            required: ['projectPath', 'agentId', 'decision']
        }
    }
];
