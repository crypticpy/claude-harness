---
name: session-management
description: "Complete session-based development workflow for implementation tasks"
---

# Session-Based Workflow System

Use this skill for multi-phase implementations requiring coordination across specialists.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SESSION-BASED SYSTEM                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌─────────────────┐    ┌─────────────────────┐ │
│  │ CENTRAL AI   │    │ MASTER          │    │ SESSION FILES       │ │
│  │ Coordinator  │◄──►│ ORCHESTRATOR    │◄──►│ .claude/tasks/      │ │
│  │              │    │ Strategic Plan  │    │ Source of Truth     │ │
│  └──────────────┘    └─────────────────┘    └─────────────────────┘ │
│         │                      │                       │            │
│         │              ┌───────────────────┐           │            │
│         └─────────────►│ SESSION PIPELINE  │◄──────────┘            │
│                        │ Task Management   │                        │
│                        │ TodoWrite Sync    │                        │
│                        └───────────────────┘                        │
│                                 │                                   │
│  ┌──────────────────────────────┼─────────────────────────────────┐ │
│  │         SPECIALIST AGENTS    │                                 │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │ │
│  │  │ Forge Rust  │ │ Forge       │ │ Backend     │               │ │
│  │  │ Backend     │ │ Frontend    │ │ Engineer    │               │ │
│  │  └─────────────┘ └─────────────┘ └─────────────┘               │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │ │
│  │  │ Quality     │ │ Code        │ │ Performance │               │ │
│  │  │ Engineer    │ │ Reviewer    │ │ Optimizer   │               │ │
│  │  └─────────────┘ └─────────────┘ └─────────────┘               │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6-Phase Session Flow

### Phase 1: Request Analysis & Initialization

**Central AI → Master Orchestrator**:

```
"USER'S ORIGINAL REQUEST: [verbatim request]

INITIALIZATION REQUIREMENTS:
- Create session file in .claude/tasks/
- Analyze complexity and scope
- Determine workflow mode (Development/Research/Debug/Validation)
- Break down into atomic tasks (1-4 hours each)
- Assign to appropriate specialists

Think hard and provide comprehensive session planning."
```

**Output**: `session-current.md` with request, success criteria, task breakdown.

---

### Phase 2: Research & Planning

**Knowledge Hierarchy**:
1. **Priority 1**: Relevant skills, session history, existing codebase patterns
2. **Priority 2**: Search project for code examples, extract architectural decisions
3. **Priority 3**: WebSearch for external best practices (when internal insufficient)

**Task Breakdown Requirements**:
- Atomic tasks (1-4 hours max)
- TodoWrite-compatible checklists
- Specialist assignment
- Parallel vs sequential execution plan

---

### Phase 3: TodoWrite Synchronization

Session checklists **must mirror TodoWrite exactly**:

```markdown
# Session File:
- [ ] Task 1
- [ ] Task 2

# TodoWrite:
TodoWrite(todos=[
  {"content": "Task 1", "status": "pending"},
  {"content": "Task 2", "status": "pending"}
])
```

**Central AI Coordination**:
1. Read session file for complete context
2. Identify independent vs dependent tasks
3. Invoke specialists (parallel or sequential)
4. Monitor progress through session updates

---

### Phase 4: Agent Execution

**Specialist Workflow**:
1. Read `session-current.md` for full context
2. Review prior agent work (dependencies)
3. Execute assigned tasks
4. Update session with implementation notes
5. Sync TodoWrite (mark complete immediately)
6. Prepare handoff context for next agent

**Session Update Pattern**:

```markdown
### [Agent Name] Work

**Status**: Completed
**Tasks Completed**:
- ✅ Task 1 - [brief outcome]

**Implementation Notes**: [Key decisions, patterns used]
**Next Agent Context**: [What next agent needs to know]
```

---

### Phase 5: Quality Gates

| Level | Validation |
|-------|------------|
| **Implementation** | Code compiles, basic functionality works, local testing done |
| **Integration** | API contracts validated, cross-component compatibility |
| **Quality** | Tests passing, performance benchmarks met |
| **User Acceptance** | User approves, business requirements met |

---

### Phase 6: Commit & Archive

Load the `git-commits` skill for commit creation and session archival.

**Session Continuity**:
- Extract incomplete work to new session
- Reference prior sessions for context
- `session-current.md` → `session-[number].md` after completion

---

## Session File Template

```markdown
# Session [Number] - [Title]

## Session Overview

**User Request**: [Verbatim user request]
**Workflow Mode**: Development / Research / Debug / Validation
**Success Criteria**: [What defines completion]
**Quality Gates**: [Validation checkpoints]

## Strategic Analysis

**Complexity Assessment**: Simple / Complex
**Domain Coverage**: [List of domains involved]
**Dependencies**: [Internal and external dependencies]
**Risk Factors**: [Potential challenges]

## Task Breakdown

### Phase 1: [Phase Name]

**Assigned To**: [Specialist agent]

- [ ] Task 1 - [Specific implementation detail]
- [ ] Task 2 - [Specific implementation detail]

### Phase 2: [Phase Name]

**Assigned To**: [Specialist agent]

- [ ] Task 1 - [Specific implementation detail]

## Agent Work Sections

### Master Orchestrator

**Status**: Completed
**Planning Notes**: [Strategic decisions made]
**Research Findings**: [Key discoveries and context]

### [Specialist Agent Name]

**Status**: In Progress / Completed
**Tasks Completed**:
- ✅ Task 1 - [brief outcome]

**Implementation Notes**: [What was built, how, why]
**Integration Points**: [How it connects to other work]
**Next Agent Context**: [What next agent needs to know]

## Session Metrics

**Tasks Total**: X
**Tasks Completed**: Y
**Blockers**: [Any impediments]
**Follow-up Items**: [Work for next session]

## Quality Validation

- [ ] All tests passing
- [ ] Performance benchmarks met
- [ ] Security standards validated
- [ ] User acceptance achieved
```
