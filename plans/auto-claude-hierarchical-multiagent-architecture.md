# Implementation Plan: Hierarchical Multi-Agent Architecture for Auto-Claude

Created: 2025-12-22
Status: PENDING APPROVAL

## Summary

This plan documents findings from auditing both Auto-Claude (Python) and Forge (Rust) agent architectures, identifies gaps, and proposes enhancements to enable true hierarchical multi-agent execution with full visibility at all levels.

---

## Part 1: Architectural Comparison

### Auto-Claude (Current Python Implementation)

```
┌─────────────────────────────────────────────────────────────────┐
│              PYTHON ORCHESTRATOR (Serial)                        │
│  run_autonomous_agent() - while True loop                        │
│  One session at a time, fresh ClaudeSDKClient per session        │
└───────────────────────────────────┬─────────────────────────────┘
                                    │
                              ONE AT A TIME
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT SESSION                                 │
│  Planner → Coder → QA Reviewer → QA Fixer                       │
│  Can spawn subagents via Task tool (INVISIBLE TO PYTHON)        │
└─────────────────────────────────────────────────────────────────┘
```

**Key Characteristics:**
- Serial execution at Python level
- File-based state (`implementation_plan.json`)
- File-based communication (PAUSE file, QA_FIX_REQUEST.md)
- Subagent capability exists but with ZERO visibility
- No event bus - progress via file watching + streaming markers

### Forge (Target Rust Implementation)

```
┌─────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATOR                                 │
│  - AgentPool with parallel agent management                      │
│  - TaskScheduler for work distribution                           │
│  - EventBus for real-time coordination                           │
└───────────────────────────────────┬─────────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│     AGENT 1         │ │     AGENT 2         │ │     AGENT N         │
│ State Machine:      │ │ State Machine:      │ │ State Machine:      │
│ Idle→Planning→      │ │ Idle→Planning→      │ │ Idle→Planning→      │
│ Coding→Reviewing    │ │ Coding→Reviewing    │ │ Coding→Reviewing    │
└─────────┬───────────┘ └─────────┬───────────┘ └─────────┬───────────┘
          │                       │                       │
          │    8 Planning Phases  │                       │
          │    Subtask Execution  │                       │
          └───────────────────────┼───────────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │  Tools   │ │EventBus  │ │ FileClaim│
              │  (LSP,   │ │(Pub/Sub) │ │ System   │
              │  Store)  │ │          │ │          │
              └──────────┘ └──────────┘ └──────────┘
```

**Key Characteristics:**
- Parallel agent execution via AgentPool
- Event-driven communication (TokioEventBus)
- Agent state machine with progress tracking
- 8-phase planning process
- File claim system for conflict prevention
- Peer-to-peer agent coordination
- Tauri IPC for real-time UI updates

---

## Part 2: Gap Analysis

### Critical Gaps (Must Fix)

| Gap | Auto-Claude Current | Forge Target | Impact |
|-----|---------------------|--------------|--------|
| **Parallel Agent Execution** | Serial (1 at a time) | Parallel (N agents) | Can't work on multiple tasks simultaneously |
| **Event Bus** | None (file-based) | TokioEventBus | No real-time coordination between agents |
| **Subagent Visibility** | Zero - agent spawns invisible | Full tracking via events | Can't see what subagents are doing |
| **File Conflict Prevention** | None | Claim system | Parallel agents may overwrite each other |
| **Progress Granularity** | Subtask level | Phase + subtask + tool level | Limited visibility into agent work |

### Important Gaps (Should Fix)

| Gap | Auto-Claude Current | Forge Target | Impact |
|-----|---------------------|--------------|--------|
| **Agent State Machine** | Implicit in loop | Explicit states | Harder to track agent lifecycle |
| **Planning Phases** | Single planner session | 8 sub-phases | Less structured planning |
| **Peer Communication** | None | PeerRequest/PeerResponse | Agents can't coordinate directly |
| **Work Package Model** | Phases→Subtasks | Tasks with parent/child | Less flexible work decomposition |
| **Persistent State** | File-based memory | SpacetimeDB | Limited cross-session learning |

### Nice-to-Have Gaps (Could Fix Later)

| Gap | Auto-Claude Current | Forge Target | Impact |
|-----|---------------------|--------------|--------|
| **Structural Code Intelligence** | Basic grep/glob | LSP + Symbol Store | Less precise code navigation |
| **Project Profiling** | Security analysis | Full manifest | Limited project understanding |
| **Pattern Templates** | None | Pattern matching | No project-type optimization |

---

## Part 3: Proposed Three-Tier Architecture for Auto-Claude

Based on Forge's design and your requirements for recursive agent spawning:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TIER 0: OVERSEER ORCHESTRATOR                      │
│  Python: OverseerOrchestrator class                                          │
│  - Receives tasks from roadmap/user                                          │
│  - Spawns investigation agents for planning                                  │
│  - Creates work packages from analysis                                       │
│  - Spawns N primary agents in PARALLEL                                       │
│  - Monitors all progress via EventBus                                        │
│  - Can work on MULTIPLE TASKS concurrently                                   │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────────┐
        │                         │                             │
        ▼                         ▼                             ▼
┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
│ TIER 1: PRIMARY       │ │ TIER 1: PRIMARY       │ │ TIER 1: PRIMARY       │
│ AGENT #1              │ │ AGENT #2              │ │ AGENT #3              │
│ Work Package: Backend │ │ Work Package: Frontend│ │ Work Package: Worker  │
│                       │ │                       │ │                       │
│ State Machine:        │ │ State Machine:        │ │ State Machine:        │
│ Idle→Planning→        │ │ Idle→Planning→        │ │ Idle→Planning→        │
│ Coding→Reviewing      │ │ Coding→Reviewing      │ │ Coding→Reviewing      │
│                       │ │                       │ │                       │
│ Can spawn subagents   │ │ Can spawn subagents   │ │ Can spawn subagents   │
│ for its work package  │ │ for its work package  │ │ for its work package  │
└───────┬───────────────┘ └───────┬───────────────┘ └───────┬───────────────┘
        │                         │                         │
   ┌────┼────┐               ┌────┼────┐               ┌────┼────┐
   │    │    │               │    │    │               │    │    │
   ▼    ▼    ▼               ▼    ▼    ▼               ▼    ▼    ▼
┌────┐┌────┐┌────┐     ┌────┐┌────┐┌────┐     ┌────┐┌────┐┌────┐
│SUB ││SUB ││SUB │     │SUB ││SUB ││SUB │     │SUB ││SUB ││SUB │
│1.1 ││1.2 ││1.3 │     │2.1 ││2.2 ││2.3 │     │3.1 ││3.2 ││3.3 │
└────┘└────┘└────┘     └────┘└────┘└────┘     └────┘└────┘└────┘
  │                       │                       │
  ▼                       ▼                       ▼
TIER 2: SUBAGENTS      TIER 2: SUBAGENTS      TIER 2: SUBAGENTS
- File-scoped work     - Component work        - Task work
- Report to parent     - Report to parent      - Report to parent
- Use shared tools     - Use shared tools      - Use shared tools
```

### Key Design Decisions

1. **Every agent can become a mini-orchestrator** - Primary agents can spawn and manage their own subagents for their work package

2. **Variable work package scope** - Orchestrator decides scope based on task complexity:
   - Small task: Single agent, file-scoped
   - Medium task: Multiple agents, feature-scoped
   - Large task: Agent groups, service-scoped

3. **Shared exploration toolkit at all tiers** - Every agent/subagent has access to:
   - Code exploration tools (glob, grep, read)
   - Context7 for documentation
   - Memory system for patterns/gotchas
   - Progress reporting tool

4. **Event-driven visibility** - All progress flows through EventBus:
   - Subagent → Parent Agent → Orchestrator → UI
   - Real-time updates at every level

---

## Part 4: Implementation Phases

### Phase 1: Event Bus Foundation

**Objective:** Replace file-based communication with event-driven architecture.

**New Files to Create:**
- `auto-claude/events/bus.py` - AsyncEventBus class
- `auto-claude/events/types.py` - Event type definitions
- `auto-claude/events/handlers.py` - Event handlers

**Event Types to Implement:**
```python
class EventType(Enum):
    # Task Events
    TASK_STARTED = "task_started"
    TASK_COMPLETED = "task_completed"
    TASK_PROGRESS = "task_progress"
    TASK_ERROR = "task_error"

    # Agent Events
    AGENT_SPAWNED = "agent_spawned"
    AGENT_STATUS_CHANGED = "agent_status_changed"
    AGENT_TERMINATED = "agent_terminated"

    # Subagent Events (NEW - for visibility)
    SUBAGENT_SPAWNED = "subagent_spawned"
    SUBAGENT_PROGRESS = "subagent_progress"
    SUBAGENT_COMPLETED = "subagent_completed"

    # File Events
    FILE_CLAIMED = "file_claimed"
    FILE_RELEASED = "file_released"
    FILE_MODIFIED = "file_modified"
```

**Verification:**
- [ ] Events publish and subscribe correctly
- [ ] Multiple subscribers receive events
- [ ] Events are typed and validated

---

### Phase 2: Agent Pool for Parallel Execution

**Objective:** Enable Python to run multiple Claude SDK sessions concurrently.

**New Files to Create:**
- `auto-claude/agents/pool.py` - AgentPool class
- `auto-claude/agents/handle.py` - AgentHandle for communication

**Key Implementation:**
```python
class AgentPool:
    def __init__(self, max_concurrent: int = 5, event_bus: EventBus):
        self.max_concurrent = max_concurrent
        self.event_bus = event_bus
        self.agents: Dict[AgentId, AgentHandle] = {}

    async def spawn_agent(self, config: AgentConfig) -> AgentHandle:
        """Spawn a new agent and return its handle."""

    async def assign_task(self, agent_id: AgentId, task: Task):
        """Assign a task to a specific agent."""

    def agent_statuses(self) -> List[Tuple[AgentId, AgentStatus]]:
        """Get all agent statuses."""
```

**Files to Modify:**
- `auto-claude/agents/coder.py` - Refactor to be pool-compatible
- `auto-claude/run.py` - Add parallel execution mode

**Verification:**
- [ ] Can spawn 3+ agents concurrently
- [ ] Each agent has isolated worktree
- [ ] Progress aggregates correctly

---

### Phase 3: File Claim System

**Objective:** Prevent conflicts when multiple agents work in parallel.

**New Files to Create:**
- `auto-claude/coordination/claims.py` - FileClaimManager class

**Claim Modes:**
```python
class ClaimMode(Enum):
    READ = "read"        # Multiple readers OK
    WRITE = "write"      # One writer, no readers
    EXCLUSIVE = "exclusive"  # One owner, blocks all
```

**Integration Points:**
- Agent must claim files before modifying
- Claims checked in security hooks
- Release on session end or explicit release

**Verification:**
- [ ] Concurrent writes to same file blocked
- [ ] Multiple readers allowed
- [ ] Claims auto-release on agent termination

---

### Phase 4: Subagent Progress Visibility

**Objective:** Track and display progress from agent-spawned subagents.

**Approach:** Custom MCP tool + Prompt injection

**New Files to Create:**
- `auto-claude/agents/tools_pkg/subagent_reporter.py` - MCP tool for subagents to report progress
- `auto-claude/agents/subagent_monitor.py` - Aggregates subagent events

**Tool Definition:**
```python
@mcp_tool("report_progress")
async def report_progress(
    subagent_id: str,
    parent_agent_id: str,
    status: str,  # "started", "progress", "completed", "failed"
    progress_pct: float,
    message: str,
    files_modified: List[str] = None
) -> dict:
    """Report subagent progress to the orchestrator."""
```

**Prompt Injection for Subagents:**
```markdown
## Progress Reporting (REQUIRED)

You MUST report progress using the `report_progress` tool:
1. Call immediately when starting work
2. Call after completing each file
3. Call with final status when done

Your parent agent and the orchestrator are monitoring your progress.
```

**Files to Modify:**
- `auto-claude/prompts/coder.md` - Add subagent reporting instructions
- `auto-claude/ui/status.py` - Add subagent tracking fields

**Verification:**
- [ ] Subagent spawns trigger events
- [ ] Progress updates flow to UI
- [ ] Worker counts update in real-time

---

### Phase 5: Work Package Model

**Objective:** Add flexible work decomposition with parent-child relationships.

**New Files to Create:**
- `auto-claude/implementation_plan/work_package.py` - WorkPackage class

**Data Model:**
```python
@dataclass
class WorkPackage:
    id: str
    title: str
    description: str
    scope: WorkPackageScope  # FILE, FEATURE, SERVICE
    parent_id: Optional[str]  # For hierarchical packages
    child_ids: List[str]
    subtasks: List[Subtask]
    assigned_agent: Optional[AgentId]
    status: WorkPackageStatus
    dependencies: List[str]  # Other package IDs
```

**Files to Modify:**
- `auto-claude/implementation_plan/plan.py` - Add work package support
- `auto-claude/prompts/planner.md` - Generate work packages

**Verification:**
- [ ] Planner creates work packages
- [ ] Packages can be nested (parent/child)
- [ ] Dependencies respected in scheduling

---

### Phase 6: Orchestrator Refactor

**Objective:** Create OverseerOrchestrator that coordinates everything.

**New Files to Create:**
- `auto-claude/orchestrator/overseer.py` - OverseerOrchestrator class
- `auto-claude/orchestrator/scheduler.py` - TaskScheduler class

**Orchestrator Responsibilities:**
1. Receive task from user/roadmap
2. Spawn investigation agents for analysis
3. Create work packages from findings
4. Spawn primary agents for packages
5. Monitor progress via EventBus
6. Handle failures and reassignments
7. Aggregate results and report

**Verification:**
- [ ] Orchestrator spawns multiple agents
- [ ] Work packages assigned correctly
- [ ] Progress visible at all levels

---

### Phase 7: UI Enhancements

**Objective:** Display full agent hierarchy with real-time progress.

**Files to Modify:**
- `auto-claude-ui/src/main/file-watcher.ts` - Watch event stream
- `auto-claude-ui/src/renderer/stores/task-store.ts` - Agent tree state
- `auto-claude-ui/src/shared/types/task.ts` - Hierarchy types

**New Components:**
- `AgentHierarchyTree` - Nested tree view of all agents
- `SubagentProgressCard` - Individual subagent status
- `WorkPackageView` - Package breakdown display

**Verification:**
- [ ] Agent tree displays correctly
- [ ] Real-time progress updates
- [ ] Can drill down into any level

---

## Part 5: Agent Context & Autonomy Model

Agents and subagents should be **autonomous adapters** - they receive solid task info but adapt to their surroundings independently.

### Context Access (Every Agent/Subagent)

| Context Source | Purpose | Access Method |
|----------------|---------|---------------|
| **Graph/Memory System** | Project understanding, patterns, gotchas | Graphiti or file-based memory |
| **Roadmap** | Overall task structure, dependencies | `implementation_plan.json` or roadmap file |
| **Task Type Details** | Workflow type, expected patterns | Task metadata |
| **Other Agent Awareness** | Know what peers are working on | EventBus subscription |
| **File Claims Registry** | See who owns what files | ClaimManager query |

### Situational Awareness Pattern

```
"I'm putting on the tire, that other agent is working on the suspension"
```

Agents should be able to:
1. Query the EventBus for active agent statuses
2. See high-level descriptions of peer work packages
3. Understand file ownership before claiming
4. Coordinate via events, not direct communication

### Base Tool Access (Autonomous)

Agents have full autonomy with these tools - no prescription of when to use them:

| Tool Category | Tools | Purpose |
|---------------|-------|---------|
| **Exploration** | glob, grep, read | Understand codebase |
| **Documentation** | Context7 MCP | Fetch library docs |
| **Memory** | record_discovery, record_gotcha | Persist learnings |
| **Coordination** | report_progress, claim_files | Work with others |
| **Execution** | edit, write, bash | Make changes |

Agents decide WHEN and HOW to use tools based on their task and discoveries.

---

## Part 6: Configuration Options

**New Configuration in `.env` or `task_metadata.json`:**

```json
{
  "orchestrator": {
    "max_concurrent_agents": 5,
    "max_subagent_depth": 2,           // 2 levels from Agent (not counting orchestrator)
    "work_package_scope": "auto",       // "file", "feature", "service", "auto"
    "enable_parallel_execution": true,
    "task_classification": {
      "enabled": true,
      "tiny_threshold": "single_file_minor_change",
      "force_serial_for_tiny": true     // Hook applies single-agent workflow
    }
  },
  "agent_context": {
    "graph_memory_enabled": true,       // Graphiti or fallback to file-based
    "peer_awareness_enabled": true,     // Can see other agents' work
    "roadmap_access": true,             // Can see full implementation plan
    "file_claims_visible": true         // Can query who owns what
  },
  "visibility": {
    "subagent_tracking": true,
    "event_retention_hours": 24
  }
}
```

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Git conflicts with parallel agents | High | High | File claim system + isolated worktrees |
| API rate limits with many agents | High | High | Configurable max concurrent + backoff |
| Subagent progress not reported | Medium | Medium | Prompt reinforcement + timeout detection |
| EventBus overhead | Low | Medium | Efficient async implementation |
| Complexity in debugging | High | Medium | Comprehensive logging with agent IDs |
| Context overflow in deep hierarchies | Medium | Medium | Limit to 2 levels + summary aggregation |

---

## User Decisions (CONFIRMED)

1. **Max concurrent agents:** 5 (default) ✓

2. **Subagent depth limit:** 2 levels FROM Agent (Orchestrator doesn't count)
   - Orchestrator → Agent (Tier 1) → Subagent (Tier 2) → Sub-subagent (Tier 3)
   - Mirror forge-project patterns when in doubt

3. **Work package auto-sizing:** Auto-determine with human override possible ✓

4. **Agent Autonomy & Context:**
   - Agents get solid task info but adapt independently
   - Access to graph/memory system for project understanding
   - Access to overall roadmap and task type details
   - High-level awareness of what other agents are working on
   - Example: "I'm putting on the tire, that other agent is working on the suspension"

5. **Task Classification for Efficiency:**
   - Orchestrator classifies task complexity during scoping phase
   - Metadata programmatically applies hook for "tiny" tasks
   - Forces single-agent workflow to avoid wasting resources
   - Serial mode as fallback, not manual flag

---

## Implementation Priority (APPROVED)

1. **Phase 1 (Event Bus)** - Foundation for everything else
2. **Phase 2 (Agent Pool)** - Enable parallel execution
3. **Phase 3 (File Claims)** - Prevent conflicts in parallel mode
4. **Phase 4 (Subagent Visibility)** - Track subagent progress
5. **Phase 5 (Work Packages)** - Better work decomposition
6. **Phase 6 (Orchestrator)** - Full hierarchical control with task classification
7. **Phase 7 (UI)** - Visual representation

---

## Status: APPROVED - IMPLEMENTATION IN PROGRESS
