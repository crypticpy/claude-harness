# Swarm Coordination System - Wiring Guide

## Overview

The multi-agent swarm coordination system is now wired into Claude Code through three layers:

1. **MCP Tools** (context-layer plugin) - Agent interaction tools
2. **Session Hooks** (unified hooks) - Automatic status injection
3. **Git-based Coordination** (.swarm/ directory in projects)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Claude Code Agent                     │
└────┬─────────────────────────────────────────────┬──────┘
     │                                              │
     │ MCP Tools                                    │ Hooks
     │                                              │
┌────▼──────────────────────────┐    ┌────────────▼──────┐
│    context-layer/             │    │  unified/modules/ │
│    src/tools/swarm-tools.ts   │    │  swarm-agent.mjs  │
│                                │    │                   │
│  • swarm_init                 │    │  • checkSwarm()   │
│  • swarm_query_board          │    │  • getAgentId()   │
│  • swarm_claim_task           │    │  • loadBoard()    │
│  • swarm_complete_task        │    │                   │
│  • swarm_send_message         │    │  Injected at:     │
│  • swarm_read_messages        │    │  session-start    │
│  • swarm_log_decision         │    │                   │
└───────────────┬───────────────┘    └───────────┬───────┘
                │                                 │
                │          Git Repository         │
                │      ┌──────────────────┐       │
                └─────►│   .swarm/        │◄──────┘
                       │  • board.json    │
                       │  • file-locks    │
                       │  • messages/     │
                       │  • decisions     │
                       └──────────────────┘
                                │
                         ┌──────┴───────┐
                         │   git sync   │
                         └──────┬───────┘
                                │
                    ┌───────────┴───────────┐
                    │   Other Agent         │
                    │   Instances           │
                    └───────────────────────┘
```

## Components

### 1. MCP Tools (context-layer/src/tools/swarm-tools.ts)

**Purpose**: Programmatic API for agents to interact with coordination system

**Tools**:
- `swarm_init`: Initialize .swarm/ structure in a project
- `swarm_query_board`: Query task board (my tasks, available tasks, stats)
- `swarm_claim_task`: Claim a ready task (locks files, moves to in_progress)
- `swarm_complete_task`: Mark task done (unlocks files, moves to review)
- `swarm_send_message`: Send message to another agent
- `swarm_read_messages`: Read messages from other agents
- `swarm_log_decision`: Log architectural decisions

**Registration**: Tools are registered in `context-layer/src/index.ts` and exposed via MCP

**Usage**:
```typescript
// Agent workflow
const board = await swarm_query_board({
  projectPath: '/path/to/project',
  agentId: 'user@hostname',
  agentSkills: ['typescript', 'react']
});

await swarm_claim_task({
  projectPath: '/path/to/project',
  taskId: 'task-1',
  agentId: 'user@hostname'
});

// ... do work ...

await swarm_complete_task({
  projectPath: '/path/to/project',
  taskId: 'task-1',
  agentId: 'user@hostname',
  prUrl: 'https://github.com/org/repo/pull/42'
});
```

### 2. Session Hook (unified/modules/swarm-agent.mjs)

**Purpose**: Automatically inject swarm status at session start

**Functions**:
- `getAgentId()`: Generate unique agent ID (username@hostname)
- `hasSwarm(projectPath)`: Check if .swarm/ exists
- `loadBoard(projectPath)`: Load board.json
- `checkMessages(projectPath, agentId)`: Check for messages
- `generateSwarmContext(projectPath, agentId)`: Build context injection
- `checkSwarm(projectPath)`: Main entry point

**Integration**: Called by `session-start.mjs` on every session start

**Output**: Injects markdown context showing:
- Agent ID
- Active tasks assigned to this agent
- Tasks in review
- Available tasks to claim
- Unread messages
- Tool quick reference

**Example Output**:
```markdown
# SWARM COORDINATION ACTIVE

**Agent ID**: john@mbp-dev
**Project**: my-saas-app

## Current Status
- **Active Tasks**: 1
- **In Review**: 0
- **Available Tasks**: 3
- **Unread Messages**: 2

## Your Active Tasks
- **task-auth-1**: Implement OAuth2 flow
  - Files: src/auth/oauth.ts, src/middleware/auth.ts
  - Started: 1/19/2026, 2:30 PM

## Available Tools
Use these MCP tools to interact with the swarm:
- `swarm_query_board`: See all tasks and board status
- `swarm_claim_task`: Claim a task from ready column
...
```

### 3. Git-based Coordination (.swarm/)

**Structure**:
```
.swarm/
├── board.json           # Task board (Kanban columns)
├── file-locks.json      # File locking registry
├── messages/            # Agent-to-agent messages
│   ├── agent1@host/
│   │   └── msg-*.json
│   └── agent2@host/
│       └── msg-*.json
├── agents/              # Agent heartbeats (future)
└── decisions.jsonl      # Decision log
```

**board.json Schema**:
```json
{
  "project": "my-app",
  "created": "2026-01-19T...",
  "phases": [
    {
      "id": "phase-1",
      "name": "Authentication",
      "order": 1,
      "status": "in_progress"
    }
  ],
  "tasks": {
    "backlog": [],
    "ready": [
      {
        "id": "task-1",
        "phase": "phase-1",
        "title": "Implement OAuth2",
        "skills": ["backend", "typescript"],
        "files": ["src/auth/oauth.ts"],
        "depends_on": [],
        "priority": 1,
        "estimated_hours": 4
      }
    ],
    "in_progress": [],
    "review": [],
    "done": []
  }
}
```

**file-locks.json Schema**:
```json
{
  "locks": {
    "src/auth/oauth.ts": {
      "task": "task-1",
      "agent": "john@mbp-dev",
      "locked_at": "2026-01-19T14:30:00Z",
      "reason": "Implement OAuth2"
    }
  },
  "expired_after_hours": 8
}
```

## Workflow

### Initial Setup (One-time per project)

1. Initialize swarm in project:
```bash
# As first agent in project
cd /path/to/project
```

2. Use MCP tool:
```typescript
await swarm_init({
  projectPath: process.cwd(),
  projectName: 'my-saas-app'
});
```

3. Create initial board manually or via tool:
```bash
# Edit .swarm/board.json
# Add phases, tasks, dependencies
```

4. Commit to git:
```bash
git add .swarm/
git commit -m "swarm: initialize coordination"
git push
```

### Agent Workflow (Repeated)

1. **Session Start**: Agent starts Claude Code
   - Hook automatically detects .swarm/
   - Shows current status, tasks, messages
   - Agent sees their active tasks

2. **Query Board**:
```typescript
const { myTasks, availableTasks } = await swarm_query_board({
  projectPath: process.cwd(),
  agentId: getAgentId(),
  agentSkills: ['typescript', 'react']
});
```

3. **Claim Task**:
```typescript
await swarm_claim_task({
  projectPath: process.cwd(),
  taskId: 'task-1',
  agentId: getAgentId()
});
// Files locked, task moved to in_progress
// Git commit created
```

4. **Work on Task**:
   - Agent implements code
   - Makes edits to locked files
   - Can check other agents' progress via board

5. **Complete Task**:
```typescript
await swarm_complete_task({
  projectPath: process.cwd(),
  taskId: 'task-1',
  agentId: getAgentId(),
  prUrl: 'https://...'
});
// Files unlocked
// Task moved to review
// Dependent tasks may become ready
// Git commit created
```

6. **Sync with Other Agents**:
```bash
git pull --rebase
git push
```

### Communication

**Send Message**:
```typescript
await swarm_send_message({
  projectPath: process.cwd(),
  from: getAgentId(),
  to: 'other-agent@host',
  type: 'api_contract_request',
  content: {
    endpoint: '/api/users',
    method: 'GET',
    query: 'What auth middleware do I use?'
  }
});
```

**Read Messages**:
```typescript
const { messages } = await swarm_read_messages({
  projectPath: process.cwd(),
  agentId: getAgentId()
});
// Process messages, respond if needed
```

**Log Decision**:
```typescript
await swarm_log_decision({
  projectPath: process.cwd(),
  agentId: getAgentId(),
  decision: 'Use JWT tokens with 1h expiry',
  context: 'task-auth-1',
  rationale: 'Balance between security and UX'
});
```

## Benefits

1. **No Central Orchestrator**: Agents coordinate peer-to-peer via git
2. **File Lock Safety**: Prevents merge conflicts automatically
3. **Dependency Management**: Tasks wait for dependencies
4. **Automatic Context**: Session starts show agent status
5. **Audit Trail**: All actions git-committed
6. **Human Oversight**: .swarm/ files human-readable, editable
7. **Asynchronous**: Agents work independently, sync via git

## Configuration

Enable swarm coordination by:

1. **MCP Tools**: Already registered in context-layer
2. **Hooks**: Already wired in unified/modules/session-start.mjs
3. **Per-Project**: Run `swarm_init` in each project that needs coordination

No global configuration required!

## Troubleshooting

**Hook not firing**:
- Check unified-hook.mjs is wired in settings.json
- Check session-start case in orchestrator

**Tools not available**:
- Rebuild context-layer: `cd ~/.claude/plugins/context-layer && npm run build`
- Check MCP server config

**File locks stale**:
- Locks expire after 8 hours (configurable in file-locks.json)
- Manual cleanup: edit file-locks.json and commit

**Git conflicts**:
- Rare, since files are locked
- Resolve manually, favor most recent timestamp

## Future Enhancements

- Agent heartbeats (.swarm/agents/)
- Consensus protocol for decisions
- Task priority auto-adjustment
- Inter-agent skill discovery
- Board visualization UI
- Lock timeout notifications
