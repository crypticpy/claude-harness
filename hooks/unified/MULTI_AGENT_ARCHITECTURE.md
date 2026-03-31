# Multi-Agent SaaS Development: Decentralized Swarm Architecture

> **Goal**: Build an entire SaaS application (dozens of features, full-stack) using coordinated Claude Code instances that work like a development team, splitting work and communicating without a central orchestrator.

## The Problem with Traditional Orchestration

**Traditional Approach** (what others do):
```
        ┌──────────────┐
        │ Orchestrator │  ← Single point of failure
        │   (Queen)    │  ← Bottleneck
        └──────┬───────┘
           ┌───┴───┬───────┬───────┐
           ▼       ▼       ▼       ▼
        Agent1  Agent2  Agent3  Agent4
```

**Problems**:
- Orchestrator becomes bottleneck
- Agents are "dumb workers" waiting for instructions
- Scaling requires orchestrator complexity
- Context compaction kills coordination knowledge

---

## Our Solution: Git-Based Decentralized Swarm

**Key Insight**: Use Git as a coordination substrate + file-based messaging

```
    Shared Git Repo (coordination substrate)
    └── .swarm/
        ├── board.json          # Task board (Kanban)
        ├── messages/           # Agent-to-agent messages
        ├── decisions.jsonl     # Decision log
        ├── file-locks.json     # File reservation system
        └── agents/
            ├── agent-1-status.json
            ├── agent-2-status.json
            └── ...

Each Agent:
  - Has full Memento system (perfect memory)
  - Can read the entire .swarm/ coordination state
  - Makes autonomous decisions
  - Coordinates via Git commits
  - No central orchestrator
```

**Inspiration**: <cite index="25-2,25-3">EvoGit framework where agents coordinate "without centralized coordination, explicit message passing, or shared memory. Instead, all coordination emerges through a Git-based phylogenetic graph"</cite>

---

## Architecture: 4-Layer System

### Layer 1: Git Worktree Isolation

<cite index="22-2,22-3">Git worktrees allow "not just switch between tasks — but truly work on multiple things simultaneously, each with its own dedicated AI assistant"</cite>

**Structure**:
```
saas-project/
├── main/                    # Main worktree (integration point)
├── agent-frontend-1/        # Worktree for frontend agent
├── agent-backend-1/         # Worktree for backend agent
├── agent-auth-1/            # Worktree for auth agent
├── agent-testing-1/         # Worktree for testing agent
└── .swarm/                  # Shared coordination (in main, visible to all)
```

**Setup**:
```bash
# Initialize main repo
git clone <repo> saas-project/main
cd saas-project/main

# Create .swarm coordination structure
mkdir -p .swarm/{messages,agents}
git add .swarm && git commit -m "Init swarm coordination"

# Create worktrees for each agent
git worktree add ../agent-frontend-1 -b agent/frontend-1
git worktree add ../agent-backend-1 -b agent/backend-1
git worktree add ../agent-auth-1 -b agent/auth-1
git worktree add ../agent-testing-1 -b agent/testing-1
```

**Benefits**:
- <cite index="24-23,24-24">Each agent operates in "complete isolation. They can make changes, run tests, and even break things temporarily, without affecting the others"</cite>
- All agents see the same .swarm/ coordination files via shared Git history
- Changes committed in any worktree are immediately available to all others

---

### Layer 2: File-Based Message Passing

**Instead of WebSockets/HTTP**, use Git-tracked JSON files for communication.

**Message Structure**:
```json
{
  "id": "msg-uuid",
  "from": "agent-frontend-1",
  "to": "agent-backend-1",  // or "broadcast" for all
  "timestamp": "2026-01-19T08:00:00Z",
  "type": "request_api_contract",
  "content": {
    "feature": "user authentication",
    "endpoints_needed": [
      "POST /api/auth/login",
      "POST /api/auth/register",
      "GET /api/auth/me"
    ]
  },
  "reply_to": null,
  "status": "pending"
}
```

**Write to**: `.swarm/messages/{to-agent}/{msg-id}.json`

**Hook Integration** (PreToolUse):
```javascript
// Check for new messages before every action
const messages = checkMessages(myAgentId);
if (messages.length > 0) {
  injectContext(`
📬 NEW MESSAGES (${messages.length}):
${messages.map(m => `- From ${m.from}: ${m.type}`).join('\n')}

Use recall_history to see message details.
  `);
}
```

**Advantages**:
- Survives context compaction (messages in Git)
- Async by default (no blocking)
- Full audit trail
- Can be queried by Memento advisor

---

### Layer 3: Intelligent Task Board (Kanban)

**File**: `.swarm/board.json`

```json
{
  "backlog": [
    {
      "id": "task-uuid-1",
      "title": "User authentication system",
      "description": "Implement OAuth + JWT",
      "complexity": "high",
      "dependencies": [],
      "estimated_hours": 8,
      "skills_required": ["backend", "security"],
      "files_involved": ["src/auth/*", "src/middleware/auth.ts"]
    }
  ],
  "ready": [
    {
      "id": "task-uuid-2",
      "title": "Login UI component",
      "complexity": "medium",
      "dependencies": [],
      "skills_required": ["frontend", "react"]
    }
  ],
  "in_progress": [
    {
      "id": "task-uuid-3",
      "title": "Database schema",
      "assignee": "agent-backend-1",
      "started_at": "2026-01-19T07:00:00Z",
      "files_locked": ["prisma/schema.prisma"]
    }
  ],
  "review": [],
  "done": []
}
```

**Agent Behavior** (autonomous):
1. Pull latest .swarm/board.json
2. Evaluate ready tasks against my capabilities
3. Pick highest-priority task I can handle
4. Reserve files (file-locks.json)
5. Move task to in_progress with my ID
6. Commit & push
7. Start work

**Hook Integration** (SessionStart):
```javascript
// Show task board on session start
const board = readBoard();
const myTasks = board.in_progress.filter(t => t.assignee === myAgentId);
const availableTasks = board.ready.filter(t => canHandle(t, mySkills));

injectContext(`
📋 YOUR ACTIVE TASKS (${myTasks.length}):
${myTasks.map(t => `- ${t.title} (started ${t.started_at})`).join('\n')}

🎯 AVAILABLE TASKS (${availableTasks.length}):
${availableTasks.slice(0, 5).map(t => `- ${t.title} [${t.complexity}]`).join('\n')}

Use mcp_tool("swarm", "claim_task", {id: "..."}) to start new work.
`);
```

---

### Layer 4: File Reservation System

**Prevent Conflicts**: <cite index="17-9">Agents "spawn workers with file reservations (no conflicts)"</cite>

**File**: `.swarm/file-locks.json`

```json
{
  "locks": {
    "src/auth/login.ts": {
      "agent": "agent-frontend-1",
      "task": "task-uuid-2",
      "locked_at": "2026-01-19T08:00:00Z",
      "expires_at": "2026-01-19T16:00:00Z",
      "intent": "Implementing login form"
    },
    "src/api/auth.ts": {
      "agent": "agent-backend-1",
      "task": "task-uuid-3",
      "locked_at": "2026-01-19T08:00:00Z"
    }
  }
}
```

**Hook Integration** (PreToolUse for Write/Edit):
```javascript
// Before editing ANY file
const filePath = event.tool_input.file_path;
const locks = readFileLocks();

if (locks[filePath] && locks[filePath].agent !== myAgentId) {
  // File is locked by another agent
  exit(2); // Block the edit
  console.error(`
🔒 FILE LOCKED: ${filePath}
Locked by: ${locks[filePath].agent}
For task: ${locks[filePath].task}
Intent: ${locks[filePath].intent}

Send a message to coordinate or wait for release.
  `);
}
```

---

## MCP Tools for Swarm Coordination

Add these to context-layer:

### 1. `swarm_claim_task`
```typescript
{
  taskId: string;
  agentId: string;
}
→ Moves task from ready to in_progress, locks files
```

### 2. `swarm_send_message`
```typescript
{
  to: string;  // agent ID or "broadcast"
  type: string;
  content: object;
}
→ Creates message file, commits to Git
```

### 3. `swarm_read_messages`
```typescript
{
  agentId: string;
  unreadOnly?: boolean;
}
→ Returns list of messages for this agent
```

### 4. `swarm_complete_task`
```typescript
{
  taskId: string;
  agentId: string;
  pr_url?: string;
}
→ Moves task to review, releases file locks, notifies team
```

### 5. `swarm_query_board`
```typescript
{
  status?: "backlog" | "ready" | "in_progress" | "review" | "done";
  skills?: string[];
}
→ Returns filtered task list
```

### 6. `swarm_lock_files`
```typescript
{
  files: string[];
  agentId: string;
  taskId: string;
  expiryHours?: number;
}
→ Reserves files, prevents conflicts
```

---

## Decision Log for Learning

**File**: `.swarm/decisions.jsonl`

Every architectural decision is logged:

```json
{"timestamp": "2026-01-19T08:00:00Z", "agent": "agent-backend-1", "decision": "Chose PostgreSQL over MySQL for better JSON support", "context": "task-uuid-3", "consensus": false}
{"timestamp": "2026-01-19T08:15:00Z", "agent": "agent-frontend-1", "decision": "Agreed with PostgreSQL choice", "reply_to": "prev-decision-id", "consensus": true}
{"timestamp": "2026-01-19T08:30:00Z", "agent": "agent-backend-1", "decision": "Using Prisma ORM for type safety", "context": "task-uuid-3", "rationale": "TypeScript integration"}
```

**Memento Integration**:
The rolling log + decisions.jsonl give GPT-4.1 perfect memory of *why* choices were made.

```typescript
await use_mcp_tool("context-layer", "recall_history", {
  query: "Why did we choose PostgreSQL?",
  lookback: "all"
});

// GPT-4.1 searches decisions.jsonl + rolling logs
// Returns: "agent-backend-1 chose PostgreSQL on 2026-01-19 because..."
```

---

## Consensus Without Orchestrator

**Pattern**: <cite index="15-1,15-2">"Hive-Mind & Queen-Led Architecture" where a "Queen Agent coordinates the work of specialized Worker Agents"</cite>

**BUT** - we make it **peer-to-peer**:

**Lightweight Consensus Protocol**:
1. Agent proposes decision → writes to decisions.jsonl
2. Broadcasts message to all agents
3. Other agents can reply with agreement/disagreement
4. If 2+ agents agree within 10 minutes → consensus reached
5. If disagreement → human review flagged in task board

**Example**:
```bash
# Agent-backend-1 proposes
echo '{"type":"proposal","content":"Use Redis for sessions"}' | \
  npx swarm-broadcast

# Agent-frontend-1 & agent-testing-1 agree
echo '{"type":"agree","proposal_id":"..."}' | \
  npx swarm-message agent-backend-1

# Consensus reached automatically
```

---

## Coordination Hooks

**New hooks for swarm coordination**:

### `swarm-sync` (runs every 5 minutes in background)
```bash
# Pull latest coordination state
git fetch origin
git merge --ff-only origin/main .swarm/

# Check for new messages, tasks, decisions
# Update local state
```

### `swarm-heartbeat` (runs every 30 seconds)
```bash
# Update agent status
echo '{"agent":"agent-frontend-1","status":"working","task":"task-uuid-2","last_seen":"'$(date -Iseconds)'"}' \
  > .swarm/agents/agent-frontend-1-status.json

git add .swarm/agents/agent-frontend-1-status.json
git commit -m "heartbeat: agent-frontend-1" --no-verify
git push origin agent/frontend-1:agent/frontend-1
```

### `swarm-conflict-detect` (PreToolUse)
```bash
# Before editing, check if another agent modified same file recently
git log --since="10 minutes ago" --all -- $FILE_PATH | grep -v $MY_AGENT
if [ $? -eq 0 ]; then
  echo "⚠️ Recent changes by another agent - coordinate first"
  exit 2
fi
```

---

## Complete Workflow Example

**Scenario**: Build SaaS with user auth, dashboard, and API

### 1. **PRD Breakdown** (human does this once)
```bash
# Human creates initial board.json
cat > .swarm/board.json << 'EOF'
{
  "backlog": [
    {"id": "1", "title": "User authentication", "skills": ["backend","security"]},
    {"id": "2", "title": "Login UI", "skills": ["frontend","react"]},
    {"id": "3", "title": "Dashboard layout", "skills": ["frontend","design"]},
    {"id": "4", "title": "REST API endpoints", "skills": ["backend","api"]},
    {"id": "5", "title": "Database schema", "skills": ["backend","database"]},
    {"id": "6", "title": "Integration tests", "skills": ["testing","e2e"]}
  ],
  "ready": [],
  "in_progress": [],
  "review": [],
  "done": []
}
EOF

git add .swarm && git commit -m "Initial task breakdown" && git push
```

### 2. **Spawn Agents** (one terminal per agent)
```bash
# Terminal 1 - Frontend specialist
cd saas-project/agent-frontend-1
claude code
# > "Start working on SaaS project. Check available tasks."

# Terminal 2 - Backend specialist  
cd saas-project/agent-backend-1
claude code
# > "Start working on SaaS project. Check available tasks."

# Terminal 3 - Testing specialist
cd saas-project/agent-testing-1
claude code
# > "Start working on SaaS project. Check available tasks."
```

### 3. **Autonomous Coordination**

**Agent-backend-1**:
```
[SessionStart hook runs]
📋 TASK BOARD:
  Backlog: 6 tasks
  Available for you: 
    - User authentication [backend, security]
    - Database schema [backend, database]
    - REST API endpoints [backend, api]

[Agent decides]
I'll start with database schema since auth depends on it.

> use_mcp_tool("swarm", "claim_task", {taskId: "5"})
> use_mcp_tool("swarm", "lock_files", {
    files: ["prisma/schema.prisma", "prisma/migrations/*"],
    taskId: "5"
  })

[Starts working on schema]
```

**Agent-frontend-1** (simultaneously):
```
[SessionStart hook runs]
📋 TASK BOARD:
  Available for you:
    - Login UI [frontend, react]
    - Dashboard layout [frontend, design]

[Agent decides]
I should coordinate with backend on auth API before building login UI.

> use_mcp_tool("swarm", "send_message", {
    to: "agent-backend-1",
    type: "api_contract_request",
    content: {feature: "authentication", endpoints_needed: ["/login", "/register"]}
  })

Meanwhile, I'll start on dashboard layout.

> use_mcp_tool("swarm", "claim_task", {taskId: "3"})
```

**Agent-backend-1** (receives message):
```
[PreToolUse hook checks messages]
📬 NEW MESSAGE from agent-frontend-1:
   Type: api_contract_request
   Feature: authentication

[Agent responds]
> use_mcp_tool("swarm", "send_message", {
    to: "agent-frontend-1",
    type: "api_contract_response",
    content: {
      endpoints: [
        {path: "/api/auth/login", method: "POST", body: {email, password}},
        {path: "/api/auth/register", method: "POST", body: {email, password, name}},
        {path: "/api/auth/me", method: "GET", headers: {Authorization: "Bearer {token}"}}
      ]
    }
  })
```

### 4. **Continuous Integration**

Each agent periodically (every hour or when task completes):
```bash
# Rebase on main to stay up-to-date
git fetch origin main
git rebase origin/main

# If conflicts, coordinate via messages
if [ $? -ne 0 ]; then
  use_mcp_tool("swarm", "send_message", {
    to: "broadcast",
    type: "conflict_detected",
    content: {files: ["src/auth.ts"], need_coordination: true}
  })
fi
```

### 5. **Task Completion & Review**

```bash
# Agent finishes task
> use_mcp_tool("swarm", "complete_task", {
    taskId: "5",
    pr_url: "https://github.com/org/repo/pull/123"
  })

# Task moves to review column
# File locks released
# Message broadcast to team
```

### 6. **Human Review Points**

The main worktree shows the task board:
```bash
cd saas-project/main
git pull --all

# Check what's in review
jq '.review' .swarm/board.json

# Review PRs, merge if good
gh pr review 123 --approve
gh pr merge 123

# Or request changes
gh pr review 123 --request-changes --body "Needs tests"
```

---

## Scaling Strategies

### Small Project (1-5 agents)
- Simple task board
- Direct file locking
- Broadcast messages

### Medium Project (6-15 agents)
- Introduce "lead" agents per domain (frontend-lead, backend-lead)
- Domain-specific sub-boards
- Team-scoped messages

### Large Project (16+ agents)
- Hierarchical task breakdown
- Multiple repos with submodules
- Specialized coordination agents (architect, integrator)

---

## Benefits Over Orchestrator Model

| Aspect | Orchestrator | Decentralized Swarm |
|--------|-------------|---------------------|
| **Scalability** | Bottlenecks at ~10 agents | Scales to 50+ agents |
| **Fault Tolerance** | Single point of failure | Each agent autonomous |
| **Context Compaction** | Orchestrator loses history | Each agent has Memento |
| **Coordination** | Synchronous, blocking | Asynchronous, non-blocking |
| **Complexity** | Orchestrator code grows | Emergent from simple rules |
| **Audit Trail** | Orchestrator logs only | Full Git history |

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [ ] Create `.swarm/` structure in hooks
- [ ] Implement file-lock system
- [ ] Add message passing MCP tools
- [ ] Create task board JSON schema

### Phase 2: Coordination (Week 2)
- [ ] Build swarm-sync hook (background sync)
- [ ] Build swarm-heartbeat hook
- [ ] Add conflict detection (PreToolUse)
- [ ] Integrate with Memento for message recall

### Phase 3: Intelligence (Week 3)
- [ ] Add decision logging
- [ ] Build consensus protocol
- [ ] Create task claiming logic
- [ ] Add skill matching algorithm

### Phase 4: Testing (Week 4)
- [ ] Test with 2 agents on small project
- [ ] Scale to 5 agents on medium project
- [ ] Validate message passing
- [ ] Verify file locking prevents conflicts

### Phase 5: Production (Week 5)
- [ ] Build monitoring dashboard
- [ ] Add human review workflow
- [ ] Create agent health checks
- [ ] Document best practices

---

## Cost Analysis

**Traditional Orchestrator**:
- Central LLM calls: $X per coordination decision
- Scales poorly (O(n²) with agent count)

**Decentralized Swarm**:
- File-based coordination: $0
- Git operations: $0
- Only LLM costs: agent work itself
- Scales linearly (O(n))

**Typical SaaS Project** (20 features, 10 agents, 2 weeks):
- Orchestrator model: ~$500-1000 in coordination overhead
- Swarm model: ~$50 in Memento recall queries

---

## Security Considerations

1. **File Locks**: Prevent accidental overwrites
2. **Message Authentication**: Verify agent IDs in commits
3. **Review Gates**: Human approval for sensitive operations
4. **Audit Trail**: Full Git history of all decisions
5. **Sandboxing**: Each agent in isolated worktree

---

## Next Steps

Start small:
1. Add swarm MCP tools to context-layer
2. Create 2-agent test: frontend + backend
3. Give them a simple task: "Build a login page"
4. Observe coordination patterns
5. Iterate and scale

The key is that coordination *emerges* from simple rules, not complex orchestration logic.

---

## References

- <cite index="25-1">EvoGit paper on decentralized multi-agent collaboration</cite>
- <cite index="11-1,11-2">Claude-Flow's coordinated agent teams with hierarchical patterns</cite>
- <cite index="17-1,17-2">Swarm-tools multi-agent coordination surviving context death</cite>
- <cite index="22-2,22-3">Git worktrees for parallel AI agent workflows</cite>
