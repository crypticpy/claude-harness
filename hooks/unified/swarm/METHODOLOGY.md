# Swarm Kanban: Simple Multi-Agent Development Methodology

## The Flow

```
PRD → Phases → Tasks → Agents Grab → Build → Review → Done
```

That's it. No complexity.

---

## Phase 1: Human Breaks Down PRD

**Input**: Your PRD document  
**Output**: `board.json` with phases and tasks

### PRD Structure
```
# PRD: My SaaS App

## Phase 1: Foundation (Week 1)
- Database schema
- Auth system  
- Basic API structure

## Phase 2: Core Features (Week 2)
- User dashboard
- Settings page
- API endpoints for CRUD

## Phase 3: Polish (Week 3)
- Tests
- Error handling
- Documentation
```

### Task Breakdown Rules

1. **Each task = 1-4 hours of work** (fits in one agent session)
2. **Each task has clear deliverables** (files to create/modify)
3. **Dependencies are explicit** (task B needs task A done first)
4. **Skills are tagged** (frontend, backend, database, testing)

---

## Phase 2: Agent Grabs Task

### Simple Rules

1. **Look at board** → See what's `ready`
2. **Match skills** → Pick task I can do
3. **Check out task** → Move to `in_progress`, lock files
4. **Work on it** → Build the feature
5. **Submit for review** → Move to `review`, unlock files
6. **Done** → Someone merges it

### Anti-Collision

When agent checks out a task:
- Task status = `in_progress`
- Task `assignee` = agent ID
- Task `locked_files` = files only this agent can edit
- Other agents **skip** tasks that are checked out

---

## Board Schema

### `board.json`

```json
{
  "project": "My SaaS App",
  "created": "2026-01-19T08:00:00Z",
  "phases": [
    {
      "id": "phase-1",
      "name": "Foundation",
      "order": 1,
      "status": "active"
    },
    {
      "id": "phase-2", 
      "name": "Core Features",
      "order": 2,
      "status": "blocked",
      "blocked_by": ["phase-1"]
    }
  ],
  "tasks": {
    "backlog": [],
    "ready": [
      {
        "id": "task-001",
        "phase": "phase-1",
        "title": "Database schema",
        "description": "Create Prisma schema with User, Session, and Settings models",
        "skills": ["backend", "database"],
        "files": ["prisma/schema.prisma"],
        "deliverables": [
          "User model with email, password, name",
          "Session model for JWT tokens",
          "Settings model for user preferences"
        ],
        "depends_on": [],
        "estimated_hours": 2,
        "priority": 1
      },
      {
        "id": "task-002",
        "phase": "phase-1",
        "title": "Auth API endpoints",
        "description": "Implement /login, /register, /logout, /me",
        "skills": ["backend", "security"],
        "files": ["src/api/auth.ts", "src/middleware/auth.ts"],
        "deliverables": [
          "POST /api/auth/login",
          "POST /api/auth/register", 
          "POST /api/auth/logout",
          "GET /api/auth/me"
        ],
        "depends_on": ["task-001"],
        "estimated_hours": 3,
        "priority": 2
      }
    ],
    "in_progress": [],
    "review": [],
    "done": []
  }
}
```

### Task States

```
backlog → ready → in_progress → review → done
                      ↑
                (agent grabs)
```

| State | Meaning |
|-------|---------|
| `backlog` | Defined but dependencies not met |
| `ready` | Can be grabbed by any agent |
| `in_progress` | Checked out by an agent |
| `review` | Work done, needs human/agent review |
| `done` | Merged to main |

---

## File Locks

### `file-locks.json`

```json
{
  "locks": {
    "prisma/schema.prisma": {
      "task": "task-001",
      "agent": "agent-backend-1",
      "locked_at": "2026-01-19T08:00:00Z",
      "reason": "Database schema"
    }
  },
  "expired_after_hours": 8
}
```

### Lock Rules

1. **Claim task** → Auto-lock all files in `task.files`
2. **Submit review** → Auto-unlock all files
3. **Locks expire** after 8 hours (configurable)
4. **Before editing**, agent checks if file is locked by someone else

---

## Agent Workflow

### On Session Start

```
1. git pull (get latest board)
2. Read board.json
3. Show: 
   - My current tasks (in_progress where assignee = me)
   - Available tasks (ready, matching my skills)
```

### Grabbing a Task

```javascript
// Agent wants task-002
{
  // 1. Check dependencies met
  const task = board.tasks.ready.find(t => t.id === "task-002");
  const depsComplete = task.depends_on.every(
    depId => board.tasks.done.some(t => t.id === depId)
  );
  
  if (!depsComplete) {
    return "❌ Dependencies not complete: task-001 must be done first";
  }

  // 2. Check files not locked
  const conflicts = task.files.filter(f => locks[f] && locks[f].agent !== myId);
  if (conflicts.length > 0) {
    return `❌ Files locked: ${conflicts.join(', ')}`;
  }

  // 3. Claim task
  task.status = "in_progress";
  task.assignee = myId;
  task.started_at = now();
  
  // 4. Lock files
  task.files.forEach(f => {
    locks[f] = { task: task.id, agent: myId, locked_at: now() };
  });

  // 5. Commit & push
  git.commit("claim: task-002 by agent-backend-1");
  git.push();

  return "✅ Claimed task-002: Auth API endpoints";
}
```

### Completing a Task

```javascript
// Agent finished task-002
{
  // 1. Move to review
  task.status = "review";
  task.completed_at = now();
  task.pr_branch = "agent/backend-1/task-002";

  // 2. Unlock files
  task.files.forEach(f => delete locks[f]);

  // 3. Update dependencies (unblock waiting tasks)
  board.tasks.backlog.forEach(t => {
    if (t.depends_on.includes("task-002")) {
      // Check if ALL dependencies now done
      const allDeps = t.depends_on.every(
        d => board.tasks.review.some(x => x.id === d) ||
             board.tasks.done.some(x => x.id === d)
      );
      if (allDeps) {
        // Move from backlog to ready
        moveTask(t, "backlog", "ready");
      }
    }
  });

  // 4. Commit & push
  git.commit("complete: task-002 by agent-backend-1");
  git.push();

  return "✅ Completed task-002, submitted for review";
}
```

---

## Dependency Resolution

### Automatic Unblocking

When task moves to `done`:
1. Check all `backlog` tasks
2. For each, check if `depends_on` are all `done`
3. If yes → move to `ready`

```
task-001 (ready) → agent grabs → done
                                   ↓
                          task-002 moves backlog → ready
                                   ↓
                          agent can now grab task-002
```

### Phase Gating

```json
{
  "id": "phase-2",
  "status": "blocked",
  "blocked_by": ["phase-1"],
  "unblock_when": "all_tasks_done"
}
```

Phase 2 tasks stay in `backlog` until Phase 1 is 100% `done`.

---

## Simple Priority Rules

Agents pick tasks by:

1. **Matching skills** (must have at least one skill)
2. **Lower priority number** = higher priority
3. **Fewer dependencies** (simpler first)
4. **Already in my branch** (continuity)

```javascript
function pickTask(agent, readyTasks) {
  return readyTasks
    .filter(t => t.skills.some(s => agent.skills.includes(s)))
    .filter(t => !isLocked(t))
    .sort((a, b) => a.priority - b.priority)
    [0];
}
```

---

## Example: Full SaaS Build

### Initial Board (human creates)

```json
{
  "project": "TaskManager SaaS",
  "phases": [
    {"id": "p1", "name": "Foundation", "order": 1, "status": "active"},
    {"id": "p2", "name": "Core Features", "order": 2, "status": "blocked", "blocked_by": ["p1"]},
    {"id": "p3", "name": "Polish", "order": 3, "status": "blocked", "blocked_by": ["p2"]}
  ],
  "tasks": {
    "backlog": [
      {"id": "t4", "phase": "p2", "title": "Task list UI", "depends_on": ["t3"], "skills": ["frontend"]},
      {"id": "t5", "phase": "p2", "title": "Task CRUD API", "depends_on": ["t1"], "skills": ["backend"]},
      {"id": "t6", "phase": "p3", "title": "E2E tests", "depends_on": ["t4", "t5"], "skills": ["testing"]}
    ],
    "ready": [
      {"id": "t1", "phase": "p1", "title": "Database schema", "depends_on": [], "skills": ["backend", "database"]},
      {"id": "t2", "phase": "p1", "title": "Auth system", "depends_on": [], "skills": ["backend", "security"]},
      {"id": "t3", "phase": "p1", "title": "Base layout", "depends_on": [], "skills": ["frontend"]}
    ],
    "in_progress": [],
    "review": [],
    "done": []
  }
}
```

### Agent Actions (time flows →)

```
08:00 - agent-backend-1: Claims t1 (Database schema)
08:00 - agent-frontend-1: Claims t3 (Base layout)  
08:05 - agent-backend-2: Claims t2 (Auth system)

10:00 - agent-backend-1: Completes t1 → review
        → t5 (Task CRUD API) auto-moves to ready!

10:30 - agent-frontend-1: Completes t3 → review
        → t4 (Task list UI) auto-moves to ready!

11:00 - Human: Approves t1, t3 → done
        → Phase 1 check: 2/3 done, not complete yet

12:00 - agent-backend-2: Completes t2 → review

12:30 - Human: Approves t2 → done
        → Phase 1: 3/3 done ✓
        → Phase 2 unblocks!
        → t4, t5 already in ready (dependencies met earlier)

13:00 - agent-backend-1: Claims t5
13:00 - agent-frontend-1: Claims t4

... and so on
```

---

## Quick Reference

### For Agents

```
START SESSION:
  1. git pull
  2. Check board.json
  3. See available tasks matching your skills

GRAB TASK:
  1. Pick from "ready" 
  2. Verify dependencies done
  3. Lock files
  4. Move to "in_progress"
  5. git commit & push

DO WORK:
  1. Implement deliverables
  2. Only edit locked files
  3. Commit regularly

FINISH:
  1. Move to "review"
  2. Unlock files
  3. git commit & push
  4. Wait for review
```

### For Humans

```
SETUP:
  1. Break PRD into phases
  2. Break phases into tasks (1-4 hours each)
  3. Define dependencies
  4. Create board.json
  5. Spawn agents

MONITOR:
  1. Check board.json for progress
  2. Review "review" column
  3. Approve → move to "done"
  4. Request changes → move back to "ready"

INTERVENE:
  - Stuck agent? Unlock their files, reassign task
  - Wrong approach? Add guidance to task description
  - Priority change? Update priority numbers
```

---

## That's It

No complex frameworks. Just:
- **Board** with tasks
- **Lock** before editing
- **Dependencies** gate what's available
- **Agents grab** and go

The coordination emerges from these simple rules.
