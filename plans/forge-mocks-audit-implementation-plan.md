# Implementation Plan: Forge Mocks, Placeholders, and TODOs Audit & Implementation

Created: 2025-12-21
Status: PENDING APPROVAL

## Summary

This plan documents ALL mocks, placeholders, and TODOs found in the Forge codebase and provides a roadmap to replace them with real implementations. The goal is to transition Forge from a prototype with mock data to a production-ready application.

## Audit Results Summary

| Category | Count | Severity |
|----------|-------|----------|
| Browser Mock Files | 13 files | Intentional (dev/test support) |
| UI Mock Functions | ~150 functions | High - need real backend |
| TODOs in Source Code | 7 actionable | Mixed severity |
| Rust Placeholder Implementations | 4 critical | High - core functionality |
| Test Mocks (OK to keep) | 14 files | Low - these are proper test doubles |
| Hardcoded localhost URLs | 6 locations | High - production blocker |
| Missing IPC Handlers | ~29 commands | High - frontend expects these |

---

## Scope

### In Scope
- Replace UI browser mocks with real Tauri IPC calls (already mostly done via tauri-api.ts)
- Implement missing Tauri command handlers
- Fix critical Rust placeholder implementations
- Address actionable TODOs
- Remove hardcoded localhost URLs (make configurable)
- Wire up disconnected event listeners

### Out of Scope
- Test mocks (MockAgentTools, MockLlmService, etc.) - these are proper test infrastructure
- node_modules TODOs - third-party code
- Architectural changes to orchestrator design

---

## PART 1: Critical Issues (Blocking Production Use)

### Phase 1.0: AUTONOMOUS AGENT LOOP IMPLEMENTATION (HIGHEST PRIORITY)

**THIS IS THE CORE REQUIREMENT** - The app cannot function without implementing the autonomous agent loop from the original Python codebase.

#### Reference Documentation

- **Claude Agent SDK**: https://platform.claude.com/docs/en/agent-sdk/overview
- **TypeScript SDK Reference**: https://platform.claude.com/docs/en/agent-sdk/typescript
- **Autonomous Coding Quickstart**: https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding

#### Original Python Implementation (Source of Truth)

Location: `/Users/aiml/Projects/forge/Auto-Claude/auto-claude/agents/`

| File | Purpose | Rust Equivalent Needed |
|------|---------|----------------------|
| `coder.py` | Main autonomous loop (`run_autonomous_agent()`) | `forge-agent/src/autonomous.rs` |
| `session.py` | Session runner (`run_agent_session()`) | `forge-agent/src/session.rs` |
| `base.py` | Constants, shared types | `forge-types/src/agent.rs` |
| `core/client.py` | SDK client configuration | `forge-agent/src/client.rs` |
| `tools_pkg/` | Custom MCP tools (subtask status, progress, etc.) | `forge-tools/src/mcp/` |

#### Core Components to Implement in Rust

**1. Agent Client Configuration** (`create_client()` from Python)
```
Rust must implement ClaudeAgentOptions equivalent:
- model: Model selection
- system_prompt: Expert developer prompt
- allowed_tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", ...]
- mcp_servers: {puppeteer, context7, linear, graphiti, auto-claude}
- hooks: {PreToolUse: bash_security_hook}
- max_turns: 1000
- cwd: project directory
- max_thinking_tokens: Extended thinking budget (optional)
```

**2. Autonomous Agent Loop** (`run_autonomous_agent()` from `coder.py`)
```rust
async fn run_autonomous_agent(
    project_dir: PathBuf,
    spec_dir: PathBuf,
    model: String,
    max_iterations: Option<usize>,
) -> Result<()> {
    // Main loop:
    loop {
        // 1. Check for PAUSE file (human intervention)
        // 2. Check max iterations
        // 3. Get next subtask from implementation plan
        // 4. Generate prompt for subtask
        // 5. Run agent session
        // 6. Post-session processing (commit tracking, progress update)
        // 7. Check if build complete
        // 8. Auto-continue with delay
    }
}
```

**3. Session Runner** (`run_agent_session()` from `session.py`)
```rust
async fn run_agent_session(
    client: &ClaudeSDKClient,
    message: String,
    spec_dir: PathBuf,
) -> Result<(SessionStatus, String)> {
    // Send prompt to Claude Agent SDK
    // Stream response messages
    // Handle tool use blocks
    // Handle tool results
    // Return status: "continue", "complete", or "error"
}
```

**4. Security Hook** (Bash command allowlist from `security.py`)
```rust
// Must validate bash commands against allowlist:
// - File inspection: ls, cat, head, tail, wc, grep
// - Node.js: npm, node
// - Version control: git
// - Process management: ps, lsof, sleep, pkill (dev processes only)
```

**5. Custom MCP Tools** (from `tools_pkg/`)
| Tool | Purpose |
|------|---------|
| `update_subtask_status` | Mark subtask as completed/failed |
| `get_build_progress` | Return current progress stats |
| `record_discovery` | Store implementation insights |
| `record_gotcha` | Store pitfalls/warnings |
| `get_session_context` | Retrieve context from previous sessions |
| `update_qa_status` | Update QA test results |

**6. Progress & Recovery Management**
- Subtask tracking via `implementation_plan.json`
- Commit tracking (before/after session)
- Recovery hints for failed subtasks
- Stuck subtask detection (after N attempts)

#### Implementation Strategy

**Option A: Use Claude Agent SDK (Recommended)**
- Call Claude Agent SDK via subprocess (like Python does)
- SDK handles tool execution, conversation management
- Rust handles orchestration, state, MCP tools

**Option B: Direct API Implementation**
- Implement agent loop directly against Anthropic API
- More control but more work
- Handle tool_use blocks, conversation history, etc.

#### Files to Create

```
crates/forge-agent/src/
├── autonomous.rs      # Main agent loop (from coder.py)
├── session.rs         # Session runner (from session.py)
├── client.rs          # SDK client config (from core/client.py)
├── security.rs        # Bash security hook
├── progress.rs        # Subtask progress tracking
└── recovery.rs        # Retry and recovery logic

crates/forge-tools/src/mcp/
├── mod.rs             # MCP server registration
├── subtask.rs         # Subtask status tool
├── progress.rs        # Build progress tool
├── discovery.rs       # Discovery recording tool
└── context.rs         # Session context tool
```

#### Verification

- [ ] Agent can read project files using Read tool
- [ ] Agent can modify files using Edit/Write tools
- [ ] Agent can run bash commands (within allowlist)
- [ ] Subtask status updates persist to implementation_plan.json
- [ ] Session auto-continues after completing a subtask
- [ ] PAUSE file stops agent loop
- [ ] Recovery attempts logged for failed subtasks
- [ ] Git commits tracked per session

---

### Phase 1.1: Core Agent Functionality - Rust Placeholders

**Objective**: Make the agent actually work (currently returns empty results)

**NOTE**: Phase 1.0 (Agent Loop) is the real priority. These placeholders exist because Phase 1.0 was never implemented.

**Files to Modify**:
- `crates/forge-agent/src/phases.rs:712-734` - `execute_subtask()` STUB
- `crates/forge-agent/src/phases.rs:736-759` - `execute_review()` STUB
- `crates/forge-cli/src/commands/build.rs:111-209` - Build loop placeholder
- `crates/forge-tools/src/tools.rs:342-368` - `find_usages()` incomplete

**What Needs to Happen**:
1. `execute_subtask()` - Currently reads files but doesn't modify them. Needs to actually apply changes
2. `execute_review()` - Currently just checks warnings. Needs real code review logic
3. `run_build_loop()` - Currently prints UI mockup. Needs orchestrator integration
4. `find_usages()` - Returns empty context. Needs actual context extraction

**Verification**:
- [ ] `execute_subtask()` modifies files when given a subtask spec
- [ ] `execute_review()` produces meaningful code review feedback
- [ ] `run_build_loop()` actually runs the orchestrator
- [ ] `find_usages()` returns context around symbol usages

---

### Phase 1.2: Missing IPC Command Handlers

**Objective**: Frontend calls these but backend has no handlers

**Files to Modify**:
- `crates/forge-tauri/src/main.rs` - Register new commands
- `crates/forge-tauri/src/ipc/` - Implement handlers

**Commands to Implement (Priority Order)**:

**Critical (App won't function)**:
| Command | Frontend Location | Purpose |
|---------|------------------|---------|
| `dialog_select_directory` | Project creation | File picker dialog |
| `dialog_create_project_folder` | Project creation | Create project directory |
| `dialog_get_default_project_location` | Project creation | Default path for projects |
| `git_get_branches` | Git operations | List branches |
| `git_get_current_branch` | Git operations | Current branch name |
| `git_check_status` | Git operations | Working tree status |
| `git_initialize` | Git operations | Initialize repo |

**Important (Features incomplete)**:
| Command | Frontend Location | Purpose |
|---------|------------------|---------|
| `context_get_project` | Context panel | Project context data |
| `context_get_memory_status` | Memory settings | Memory backend status |
| `context_search_memories` | Memory search | Search memory store |
| `env_get_project` | Environment config | Project env vars |
| `file_list_directory` | File browser | Directory listing |

**Nice to Have**:
| Command | Frontend Location | Purpose |
|---------|------------------|---------|
| `app_get_version` | Settings/About | App version info |
| `app_check_update` | Settings | Check for updates |
| `infra_validate_openai_key` | Onboarding | Validate API key |
| `changelog_load_task_specs` | Changelog | Load spec content |
| `release_get_versions` | Release flow | Releaseable versions |

**Steps**:
1. Create IPC handlers for each command
2. Register in `main.rs` invoke_handler
3. Update types if needed

**Verification**:
- [ ] All commands callable from frontend without errors
- [ ] Project creation flow works end-to-end
- [ ] Git operations functional

---

### Phase 1.3: Disconnected Event Emissions

**Objective**: Backend defines events but never emits them

**Files to Modify**:
- `crates/forge-tauri/src/ipc/task.rs` - Task events
- `crates/forge-tauri/src/ipc/ideation.rs` - Ideation events

**Events to Connect**:
| Event | Current Status | Needed Action |
|-------|---------------|---------------|
| `task-progress` | Listener exists, never emitted | Emit during task execution |
| `task-error` | Listener exists, never emitted | Emit on task errors |
| `task-status-change` | Listener exists, never emitted | Emit when status changes |
| `task-execution-progress` | Listener exists, never emitted | Emit progress updates |
| `ideation-progress` | Partially connected | Verify full connection |

**Verification**:
- [ ] Frontend receives real-time task status updates
- [ ] Progress bars show actual progress, not fake data

---

### Phase 1.4: Hardcoded localhost URLs

**Objective**: Make URLs configurable for production

**Files to Modify**:
- `ui/src/shared/constants/config.ts:65` - Graphiti MCP URL
- `ui/src/components/onboarding/GraphitiStep.tsx:59,80,99` - Ollama, FalkorDB defaults
- `crates/forge-tauri/src/ipc/infrastructure.rs:156` - Graphiti MCP URL
- `crates/forge-tauri/src/ai/config.rs:227` - Ollama default URL

**Solution Options**:
1. Environment variables (recommended for production)
2. Settings file configuration
3. App settings UI

**Steps**:
1. Add config entries for each URL
2. Load from environment/settings
3. Use configured values instead of hardcoded

**Verification**:
- [ ] App can connect to non-localhost services
- [ ] URLs configurable via settings or env vars

---

## PART 2: Important Issues (Features Incomplete)

### Phase 2.1: Task Control TODOs

**Objective**: Implement task cancel/suspend/resume in orchestrator

**Files to Modify**:
- `crates/forge-tauri/src/ipc/task.rs:543` - Cancel orchestrator task
- `crates/forge-tauri/src/ipc/task.rs:598` - Suspend orchestrator task
- `crates/forge-tauri/src/ipc/task.rs:653` - Resume orchestrator task

**Current Behavior**: Tasks update local status but orchestrator keeps running

**Needed**: Orchestrator API to support:
- `cancel_task(task_id)` - Stop and clean up
- `suspend_task(task_id)` - Pause without losing state
- `resume_task(task_id)` - Continue suspended task

**Verification**:
- [ ] Cancel button actually stops task execution
- [ ] Pause button suspends, Resume continues

---

### Phase 2.2: Ideation Stop Functionality

**Objective**: Actually stop ideation generation when user clicks Stop

**File**: `crates/forge-tauri/src/ipc/ideation.rs:720`

**Current Behavior**: `ideation_stop()` is a NO-OP - returns success but generation continues

**Needed**:
- Track running generation state
- Implement cancellation token/flag
- Check flag during generation loop

**Verification**:
- [ ] Clicking Stop actually stops generation

---

### Phase 2.3: Missing Command Registration

**Objective**: Register `ideation_delete_multiple` in Tauri

**File**: `crates/forge-tauri/src/main.rs`

**Issue**: Handler exists but not registered in `invoke_handler` macro

**Fix**: Add to command list in main.rs

**Verification**:
- [ ] Multi-delete ideation works from frontend

---

## PART 3: Minor Issues (Polish)

### Phase 3.1: Terminal Search Integration

**File**: `ui/src/components/TerminalGrid.tsx:398`

**TODO**: "integrate with search when terminal exposes it"

**Status**: Low priority - terminal search is a nice-to-have feature

---

### Phase 3.2: Provider-Specific Validation

**File**: `ui/src/components/onboarding/GraphitiStep.tsx:186`

**TODO**: "Add provider-specific validation endpoints"

**Current**: All providers use OpenAI validation endpoint

**Needed**: Provider-specific health check endpoints

---

## PART 4: Browser Mocks (Keep for Development)

### Files to Keep (Intentional Dev Infrastructure)

These browser mock files are **intentional** and should be kept for browser-based UI development:

```
ui/src/lib/mocks/
├── index.ts              # Central export
├── mock-data.ts          # Sample data for UI testing
├── project-mock.ts       # Project operations mock
├── task-mock.ts          # Task operations mock
├── workspace-mock.ts     # Workspace mock
├── terminal-mock.ts      # Terminal mock
├── claude-profile-mock.ts# Profile management mock
├── roadmap-mock.ts       # Roadmap mock
├── context-mock.ts       # Context mock
├── integration-mock.ts   # External integrations mock
├── changelog-mock.ts     # Changelog mock
├── insights-mock.ts      # AI insights mock
├── infrastructure-mock.ts# Docker/FalkorDB mock
├── settings-mock.ts      # Settings mock
└── README.md             # Documentation
```

**Why Keep**:
- Enables UI development without running full Rust backend
- Useful for UI testing and Storybook-style development
- Already conditionally loaded (Tauri API takes precedence)

---

## PART 5: Test Mocks (Keep as Is)

These are proper test doubles in test modules - no action needed:

- `crates/forge-orchestrator/src/orchestrator.rs:543-600` - MockAgentTools
- `crates/forge-orchestrator/src/pool.rs:637-694` - MockAgentTools (pool tests)
- `crates/forge-orchestrator/src/lib.rs:151-208` - MockAgentTools (lib tests)
- `crates/forge-agent/src/llm.rs:407-590` - MockLlmService
- `crates/forge-tools/src/tools.rs:493-634` - MockStore, MockProfiler, MockLsp, MockPatterns
- `crates/forge-tauri/src/ai/service.rs:806-880` - MockAiService
- `crates/forge-merge/src/ai_resolver.rs:46-76` - MockAiResolver

---

## Implementation Order (Recommended)

### Priority Tier 1: Foundation (BLOCKING - Build This First)

**Step 1.0a: SpacetimeDB Integration**
- Add SpacetimeDB crate to workspace
- Create `forge-db` crate with schema definitions
- Implement core reducers (session, message, tool execution)
- Set up connection from Tauri app

**Step 1.0b: Anthropic API Client in Rust**
- Evaluate `anthropic-rs` or implement minimal client
- Message types (user, assistant, tool_use, tool_result)
- Streaming response handling
- Token counting and cost tracking

**Step 1.0c: Tool System**
- Define tool trait and JSON schema generation
- Implement core tools: Read, Write, Edit, Glob, Grep, Bash
- Implement Forge tools: update_subtask_status, get_build_progress, etc.
- Security hook for Bash command allowlist

**Step 1.0d: Autonomous Agent Loop**
- Port `run_autonomous_agent()` from Python
- Port `run_agent_session()` from Python
- Implement conversation management
- Implement progress tracking and recovery
- Wire to SpacetimeDB for persistence

### Priority Tier 2: App Functionality

2. **Phase 1.2**: Missing IPC handlers - Unblocks UI flows
3. **Phase 1.4**: Configuration system - Make URLs configurable
4. **Phase 1.3**: Event emissions via SpacetimeDB subscriptions

### Priority Tier 3: Feature Completeness

5. **Phase 2.2 + 2.3**: Ideation fixes
6. **Phase 1.1**: Clean up old placeholder implementations
7. **Phase 2.1**: Task control (cancel/pause/resume)

### Priority Tier 4: Polish

8. **Ongoing**: Part 3 items (terminal search, provider validation)

---

## New Crate Structure

```
crates/
├── forge-db/                    # NEW: SpacetimeDB module
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs               # Schema + reducers
│       ├── schema.rs            # Table definitions
│       └── reducers.rs          # Database operations
│
├── forge-anthropic/             # NEW: Direct Anthropic API client
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       ├── client.rs            # HTTP client
│       ├── messages.rs          # Message types
│       ├── streaming.rs         # SSE streaming
│       └── tools.rs             # Tool definitions
│
├── forge-agent/                 # ENHANCED: Agent loop implementation
│   └── src/
│       ├── lib.rs
│       ├── autonomous.rs        # Main agent loop
│       ├── session.rs           # Session runner
│       ├── tools/               # Tool implementations
│       │   ├── mod.rs
│       │   ├── file_ops.rs      # Read, Write, Edit
│       │   ├── search.rs        # Glob, Grep
│       │   ├── bash.rs          # Bash with security hook
│       │   └── forge.rs         # Forge-specific tools
│       ├── progress.rs          # Subtask tracking
│       ├── recovery.rs          # Retry logic
│       └── security.rs          # Bash command allowlist
│
└── ... (existing crates)
```

---

## Testing Strategy

### Unit Tests
- Each new IPC handler needs unit tests
- Rust placeholder implementations need test coverage

### Integration Tests
- End-to-end project creation flow
- Task lifecycle (create → start → complete)
- Git operations integration

### Manual Testing
- UI flows work without errors
- Real-time updates visible
- External service connections work

---

## Rollback Plan

- Git branches for each phase
- No destructive migrations
- Browser mocks remain as fallback for development

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Orchestrator API changes needed for task control | High | High | May need orchestrator redesign - scope carefully |
| Breaking browser mock fallback | Low | Medium | Keep mocks working, test in browser mode |
| Performance issues with real implementations | Medium | Medium | Profile and optimize during implementation |
| Type mismatches between frontend/backend | Medium | Low | Use shared types, validate at runtime |

---

## Architectural Decisions (CONFIRMED)

### Decision 1: Direct Anthropic API in Rust (NOT Claude Agent SDK)

**Rationale**: Full control over the agentic harness, no subprocess dependencies, tight and stable implementation.

**Implementation**:
- Use `anthropic-rs` or direct HTTP calls to Claude API
- Implement our own conversation management
- Handle tool_use blocks and tool results directly
- Manage context windows and conversation history ourselves

### Decision 2: No MCP - Direct Tool Calls in Rust

**Rationale**: All Forge auto-claude tools implemented as direct Rust functions, not MCP servers.

**Implementation**:
- Each tool is a Rust function with JSON schema definition
- Tool execution happens in-process, no IPC overhead
- Tools registered with the agent loop at startup

### Decision 3: SpacetimeDB for Agent State Storage

**Rationale**: Rich logging, time-travel queries, replay capabilities, relational queries across agents for debugging stuck agents.

**SpacetimeDB Capabilities**:
- Serverless relational database with Rust native support
- Reducers (atomic transactions) for state updates
- Real-time subscriptions for live UI updates
- Historical queries for replay/debugging
- Multi-agent relational analysis

**SpacetimeDB Schema Design**:
```rust
// Agent Sessions
#[table(name = agent_sessions, public)]
pub struct AgentSession {
    #[primary_key]
    id: String,                    // UUID
    project_id: String,
    spec_id: String,
    agent_type: String,            // "coder", "planner", "qa_reviewer"
    model: String,
    status: String,                // "running", "paused", "completed", "error"
    started_at: Timestamp,
    ended_at: Option<Timestamp>,
    iteration_count: u32,
}

// Conversation Messages
#[table(name = messages, public)]
pub struct Message {
    #[primary_key]
    id: String,                    // UUID
    session_id: String,            // FK to agent_sessions
    role: String,                  // "user", "assistant"
    content: String,               // JSON serialized content blocks
    tokens_in: u32,
    tokens_out: u32,
    created_at: Timestamp,
}

// Tool Executions
#[table(name = tool_executions, public)]
pub struct ToolExecution {
    #[primary_key]
    id: String,
    session_id: String,
    message_id: String,
    tool_name: String,
    tool_input: String,            // JSON
    tool_output: String,           // JSON
    success: bool,
    error: Option<String>,
    duration_ms: u64,
    created_at: Timestamp,
}

// Subtask Progress
#[table(name = subtasks, public)]
pub struct Subtask {
    #[primary_key]
    id: String,
    spec_id: String,
    phase_id: String,
    description: String,
    status: String,                // "pending", "in_progress", "completed", "stuck"
    attempts: u32,
    assigned_session: Option<String>,
    completed_at: Option<Timestamp>,
}

// Git Commits (tracked per session)
#[table(name = commits, public)]
pub struct Commit {
    #[primary_key]
    hash: String,
    session_id: String,
    subtask_id: Option<String>,
    message: String,
    files_changed: u32,
    created_at: Timestamp,
}

// Recovery & Debugging
#[table(name = errors, public)]
pub struct AgentError {
    #[primary_key]
    id: String,
    session_id: String,
    subtask_id: Option<String>,
    error_type: String,
    error_message: String,
    context: String,               // JSON - surrounding state
    created_at: Timestamp,
}

// Discoveries & Gotchas (learned patterns)
#[table(name = discoveries, public)]
pub struct Discovery {
    #[primary_key]
    id: String,
    session_id: String,
    discovery_type: String,        // "pattern", "gotcha", "insight"
    content: String,
    file_paths: String,            // JSON array
    created_at: Timestamp,
}
```

**SpacetimeDB Reducers for Agent Operations**:
```rust
#[reducer]
pub fn start_session(ctx: &ReducerContext, project_id: String, spec_id: String, agent_type: String, model: String) -> Result<String, String>

#[reducer]
pub fn record_message(ctx: &ReducerContext, session_id: String, role: String, content: String, tokens_in: u32, tokens_out: u32) -> Result<String, String>

#[reducer]
pub fn record_tool_execution(ctx: &ReducerContext, session_id: String, message_id: String, tool_name: String, input: String, output: String, success: bool, duration_ms: u64) -> Result<String, String>

#[reducer]
pub fn update_subtask_status(ctx: &ReducerContext, subtask_id: String, status: String) -> Result<(), String>

#[reducer]
pub fn record_error(ctx: &ReducerContext, session_id: String, subtask_id: Option<String>, error_type: String, message: String, context: String) -> Result<String, String>

// Query reducers for orchestrator debugging
#[reducer]
pub fn get_stuck_subtasks(ctx: &ReducerContext, spec_id: String) -> Result<Vec<Subtask>, String>

#[reducer]
pub fn get_error_patterns(ctx: &ReducerContext, session_id: String) -> Result<Vec<AgentError>, String>
```

### Decision 4: Forge Features as Rust Tools

**Implementation**: Each Forge-specific capability becomes a tool in the agent's toolset.

| Feature | Tool Name | Description |
|---------|-----------|-------------|
| Subtask Management | `update_subtask_status` | Mark subtasks complete/failed |
| Progress Tracking | `get_build_progress` | Return completion stats |
| Discovery Recording | `record_discovery` | Store learned patterns |
| Gotcha Recording | `record_gotcha` | Store pitfalls/warnings |
| Session Context | `get_session_context` | Retrieve prior session insights |
| QA Status | `update_qa_status` | Update test results |
| Insights | `generate_insight` | AI analysis of codebase |
| Ideation | `generate_ideas` | Feature suggestions |

---

## Remaining Open Questions

1. **Configuration System**: Environment variables, config file, or both for URL/settings?

2. **SpacetimeDB Deployment**: Self-hosted (bundled with Tauri) or Maincloud?

3. **Anthropic API Client**: Use existing `anthropic-rs` crate or implement minimal client?

---

## Key Python Files to Reference

When implementing Phase 1.0, these are the critical Python files to port:

```
/Users/aiml/Projects/forge/Auto-Claude/auto-claude/
├── agents/
│   ├── coder.py                    # Main autonomous loop
│   ├── session.py                  # Session runner
│   ├── base.py                     # Constants
│   ├── memory_manager.py           # Graphiti integration
│   ├── utils.py                    # Helper functions
│   └── tools_pkg/
│       ├── tools/subtask.py        # Subtask status tool
│       ├── tools/progress.py       # Progress tracking tool
│       └── tools/qa.py             # QA tools
├── core/
│   ├── client.py                   # SDK client configuration
│   └── workspace/                  # Worktree management
├── progress.py                     # Progress tracking
├── recovery.py                     # Recovery management
├── prompt_generator.py             # Prompt generation
└── security.py                     # Bash command allowlist
```

---

**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
