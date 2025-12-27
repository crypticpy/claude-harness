---
name: sub-agent-invocation
description: "Coordination and delegation protocols for sub-agent specialist assignments"
---

# Central AI Delegation Protocol

Load this skill before invoking ANY sub-agent (master-orchestrator, specialists, validators).

---

## Constitutional Invocation Requirements

Every sub-agent prompt **MUST** include four components:

### 1. Complete Context (Be Detailed)

- Project goal and current state
- Why this work is needed now
- How this task fits into broader objectives
- Dependencies on other work or prior decisions

### 2. Explicit Instructions (Be Clear)

- Specific task requirements with clear scope
- Expected deliverables and exact format
- Success criteria and validation requirements

### 3. Context References (Point to Sources)

- Session files: "Read .claude/tasks/session-current.md for full context"
- Skills: "Load [relevant] skill for patterns and workflows"
- Related implementations: Point to similar existing code

### 4. Performance Directives (Demand Excellence)

- Always include: "Think hard and analyze deeply before proceeding"
- Specify thoroughness level: "comprehensive analysis" or "quick validation"

---

## Invocation Template

```
"USER'S ORIGINAL REQUEST: [verbatim user prompt - MANDATORY]

[COMPREHENSIVE CONTEXT]
- Project: [overall goal and current state]
- Background: [why this matters, how it fits]
- Dependencies: [what this builds on or integrates with]

TASK ASSIGNMENT:
[Detailed, specific requirements with clear scope and boundaries]

CONTEXT REFERENCES:
- Session: [path and what to extract]
- Skills: [relevant skills to load]
- Examples: [similar existing implementations]

Think hard and provide [thoroughness level] analysis/implementation.

DELIVERABLES:
[Exact format, success criteria, validation requirements]"
```

**Sub-Agent Context Principle**: Sub-agents have temporary windows—maximize their context collection. Over-collection is safe; under-collection causes failures.

---

## Common Invocation Failures

| Bad | Good |
|-----|------|
| "Fix authentication" | "Fix OAuth redirect loop where successful login redirects to /login instead of /dashboard" |
| "Add tests" | "Add tests for user profile editing (session Phase 2) covering avatar upload, validation, error handling" |
| "Implement feature X" | "Implement feature X following patterns from Y, integrating with Z API, referencing session-current.md Phase 3" |

---

## Routing Decision

| Scenario | Approach |
|----------|----------|
| Multi-phase feature, complex dependencies | Master Orchestrator → Session |
| Simple file edit, pattern search, single-component | Direct sub-agent delegation |
| Ambiguous scope, needs planning | Master Orchestrator |
| Clear scope, bounded execution | Direct delegation |

---

## Coordination Patterns

### Parallel Execution

Invoke multiple agents using multiple Task tool calls in **ONE message**.

| Pattern | Agents | Use Case |
|---------|--------|----------|
| **Forge Parallel** | forge-rust-backend + forge-frontend-architect | Independent Forge feature development |
| **Domain Parallel** | frontend-ux-debugger + backend-engineer | Independent web feature development |
| **Validation Parallel** | quality-engineer + performance-optimizer + principal-code-reviewer | Comprehensive validation |
| **Debug Parallel** | debugger-detective + deep-researcher | Complex issue investigation |

### Sequential Dependencies

| Chain | Reasoning |
|-------|-----------|
| **Forge**: forge-rust-backend → forge-frontend-architect | Backend crates before Tauri command integration |
| Schema → API → Frontend | Data structure must exist before interfaces |
| Core → Enhancement | Foundation before optimization |
| Implementation → quality-engineer → principal-code-reviewer | Build, test, review |
| deep-researcher → master-orchestrator → Specialists | Research, plan, execute |

---

## Agent Routing Reference

### Forge Project (Priority)

| Domain | Agent | Handles |
|--------|-------|---------|
| **Rust Backend** | forge-rust-backend | Crate development, event bus, agent orchestration, SQLite/Prisma |
| **Tauri Frontend** | forge-frontend-architect | UI components, Tauri commands, theming, frontend-backend integration |

### General Development

| Domain | Agent | Handles |
|--------|-------|---------|
| **Backend** | backend-engineer | Server actions, APIs, business logic, auth |
| **Fullstack** | fullstack-architect | Cross-stack integration, Next.js, Python/FastAPI |
| **Frontend UX** | frontend-ux-debugger | UI/UX issues, visual inconsistencies, component fixes |
| **Testing** | quality-engineer | Unit, integration, E2E, coverage, pattern validation |
| **Performance** | performance-optimizer | Core Web Vitals, bundle analysis, monitoring |
| **Web Perf** | web-performance-architect | Real-time rendering, Web Audio, DSP optimization |

### Research & Quality

| Domain | Agent | Handles |
|--------|-------|---------|
| **Research** | deep-researcher | External web research, documentation analysis |
| **Debugging** | debugger-detective | Root cause analysis, systematic debugging |
| **Code Review** | principal-code-reviewer | Expert code review against project standards |
| **Final Review** | final-review-completeness | Post-implementation completeness audit |

### Specialized

| Domain | Agent | Handles |
|--------|-------|---------|
| **ML/AI** | ml-architect | ML models, pipelines, AI integrations |
| **Python** | python-maestro | Elegant Python code, Pythonic patterns |
| **Docker** | docker-macos-specialist | Docker containers, cross-platform deployment |
| **UI Testing** | ui-tester | Browser automation, form testing, user flows |

---

## Dependency Declaration Requirements

**Every task in a session plan MUST include these machine-readable fields:**

```
TASK: [task_id]
DEPENDENCIES: [list of task_ids that must complete first, or "none"]
BLOCKS: [list of task_ids that cannot start until this completes]
PARALLEL_SAFE: false  # Default is FALSE - must explicitly set to true
FILE_OWNERSHIP: [exclusive list of files this task modifies]
PHASE: [phase number]
```

### Dependency Field Rules

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `DEPENDENCIES` | Yes | `none` | Task IDs that must be "completed" before this task starts |
| `BLOCKS` | No | `[]` | Task IDs that are waiting on this task |
| `PARALLEL_SAFE` | Yes | `false` | Can this run in parallel? Must verify explicitly |
| `FILE_OWNERSHIP` | Yes | `[]` | Files this task has exclusive write access to |
| `PHASE` | Yes | `1` | Which phase this task belongs to |

### PARALLEL_SAFE Criteria

A task can ONLY be marked `PARALLEL_SAFE: true` when ALL conditions are met:

1. **No file overlap**: FILE_OWNERSHIP has ZERO overlap with any concurrent task
2. **Dependencies resolved**: All DEPENDENCIES tasks are marked "completed"
3. **Phase alignment**: Task is in the current execution phase
4. **Explicit verification**: Orchestrator has verified the above (not assumed)

**Default is FALSE**. Parallelization is opt-in, not opt-out.

---

## Pre-Dispatch Validation Protocol

**MANDATORY: Central AI MUST complete this checklist BEFORE invoking Task tool for sub-agents.**

### Step 1: Read Session State (REQUIRED)

```
Before dispatching ANY agent, Central AI MUST:
1. Read the session file: .claude/tasks/session-current.md
2. Identify current phase and task statuses
3. Verify which tasks are "completed", "in_progress", "pending"
```

**Never assume task status. Always verify by reading.**

### Step 2: Pre-Dispatch Checklist

For EACH task you intend to dispatch:

- [ ] **Dependency Check**: All tasks in DEPENDENCIES list are marked "completed" in session
- [ ] **Phase Gate Check**: Previous phase review gate has passed (if applicable)
- [ ] **File Ownership Check**: No FILE_OWNERSHIP overlap with any other in-progress task
- [ ] **PARALLEL_SAFE Check**: Task explicitly marked `PARALLEL_SAFE: true`

### Step 3: Dispatch Decision

```
┌─────────────────────────────────────────────────────────────┐
│                    DISPATCH DECISION TREE                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Can I parallelize these tasks?                             │
│  │                                                          │
│  ├── Are ALL dependency tasks "completed"?                  │
│  │   └── No → WAIT (do not dispatch yet)                   │
│  │                                                          │
│  ├── Did previous phase gate pass?                          │
│  │   └── No → WAIT (complete phase review first)           │
│  │                                                          │
│  ├── Do ANY tasks share files in FILE_OWNERSHIP?            │
│  │   └── Yes → SEQUENCE (never parallelize shared files)   │
│  │                                                          │
│  ├── Are ALL tasks marked PARALLEL_SAFE: true?              │
│  │   └── No → SEQUENCE (default to sequential)             │
│  │                                                          │
│  └── All checks pass?                                       │
│      └── Yes → PARALLEL dispatch OK                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Step 4: Dispatch Execution

**For PARALLEL dispatch:**
```
- Invoke multiple Task tools in ONE message
- Each task in the batch must have passed ALL checks
- Log: "Parallel dispatch: [task_ids] - all checks passed"
```

**For SEQUENTIAL dispatch:**
```
- Invoke ONE Task tool
- Wait for completion
- Re-read session to verify status
- Then dispatch next task
- Log: "Sequential dispatch: [task_id] - reason: [dependency/file_overlap/not_parallel_safe]"
```

### Dispatch Failure Handling

If a check fails, DO NOT dispatch. Instead:

| Failure | Action |
|---------|--------|
| Dependency not complete | Wait, check again after current tasks finish |
| Phase gate not passed | Run review agents first, then proceed |
| File ownership overlap | Sequence the tasks OR consolidate into one agent |
| PARALLEL_SAFE: false | Sequence by default |

---

## Conservative Parallelization Defaults

### Core Principle

**"Methodical and stable over ultra-parallel and brittle"**

When orchestration uncertainty exists:
- **Assume dependencies exist** → sequence by default
- **Assume file conflicts possible** → don't parallelize
- **Verify completion explicitly** → read session, don't assume
- **Default to caution** → sequence when uncertain

### Default Behaviors

| Scenario | Default | Override Requires |
|----------|---------|-------------------|
| Task has no PARALLEL_SAFE field | `false` (sequence) | Explicit `PARALLEL_SAFE: true` |
| Dependencies unclear | Assume dependent | Explicit `DEPENDENCIES: none` |
| File ownership unclear | Assume overlap | Explicit non-overlapping FILE_OWNERSHIP |
| Phase gate status unknown | Assume not passed | Explicit verification in session |

### Strict File Ownership Rule

**NEVER allow two agents to work on the same file at the same time.**

```
RULE: If FILE_OWNERSHIP lists intersect → SEQUENCE or CONSOLIDATE

Examples:
- Agent A owns: [main.py, utils.py]
- Agent B owns: [api.py, main.py]  ← CONFLICT on main.py
- Resolution: Sequence A → B, OR consolidate into single agent

NO EXCEPTIONS. File conflicts cause:
- Race conditions
- Merge conflicts
- Lost work
- Debugging nightmares
```

### When Parallelization is Safe

Parallelize ONLY when you can confirm:

1. ✅ Explicit `PARALLEL_SAFE: true` on ALL tasks in batch
2. ✅ Zero file overlap (verified by reading FILE_OWNERSHIP)
3. ✅ All dependencies "completed" (verified by reading session)
4. ✅ Phase gate passed (verified by reading session)
5. ✅ Each agent has clear, bounded scope

### When to Sequence Instead

Always sequence when:

- 🔴 Any uncertainty about dependencies
- 🔴 Any file might be shared
- 🔴 Previous phase not verified complete
- 🔴 Task lacks explicit PARALLEL_SAFE: true
- 🔴 Complex integration points between tasks
- 🔴 First time executing this type of workflow

---

## Updated Invocation Template

```
"USER'S ORIGINAL REQUEST: [verbatim user prompt - MANDATORY]

[COMPREHENSIVE CONTEXT]
- Project: [overall goal and current state]
- Background: [why this matters, how it fits]
- Dependencies: [what this builds on or integrates with]

TASK ASSIGNMENT:
[Detailed, specific requirements with clear scope and boundaries]

DEPENDENCY METADATA:
- TASK_ID: [unique identifier]
- DEPENDENCIES: [list of prerequisite task_ids, or "none"]
- PARALLEL_SAFE: [true/false - verified by Central AI]
- FILE_OWNERSHIP: [exclusive files this agent may modify]
- PHASE: [current phase number]

CONTEXT REFERENCES:
- Session: [path and what to extract]
- Skills: [relevant skills to load]
- Examples: [similar existing implementations]

FILE OWNERSHIP BOUNDARIES:
You may ONLY modify these files: [explicit list]
Do NOT touch: [files owned by other agents]

Think hard and provide [thoroughness level] analysis/implementation.

DELIVERABLES:
[Exact format, success criteria, validation requirements]"
```
