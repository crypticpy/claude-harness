# Implementation Plan: Full Tauri Desktop Integration

Created: December 2024
Status: PENDING APPROVAL

## Summary

Complete integration of the Forge Tauri desktop application with full feature parity from Auto-Claude. This includes fixing the AppState thread safety issue (TerminalManager/PtyPair not Send+Sync), replacing all 130+ stub IPC methods with real implementations, and architecting the solution "the Rust way" with forward-thinking, scalable patterns.

## Scope

### In Scope

- Fix AppState thread safety for Tauri State management
- Terminal integration with PTY spawning, output streaming, resize handling
- Full IPC command integration (~165 methods across 11 modules)
- Project management (add, remove, select, settings)
- Task management (create, update, delete, status tracking)
- Worktree operations (status, diff, merge reports)
- Settings persistence and sync
- Memory/context management (cross-session knowledge)
- AI features: Roadmap, Ideation, Insights, Changelog
- Event streaming from Rust backend to frontend
- GitHub integration (issues, PRs, commits)
- Linear integration (issues, projects)

### Out of Scope

- UI component redesign (retain existing sleekness)
- New features beyond Auto-Claude parity
- Mobile/tablet responsiveness
- Production deployment (icons, code signing, auto-update)
- Performance optimization beyond functional requirements

## Prerequisites

- Rust 1.87+ installed
- pnpm and Node.js 18+ installed
- Tauri CLI v2.9.6+ installed
- Understanding of existing Forge crate architecture

## Implementation Phases

### Phase 1: Thread Safety Refactoring

**Objective**: Make AppState fully Send + Sync for Tauri state management

**Files to Modify**:
- `crates/forge-tauri/src/terminal/mod.rs` - Refactor TerminalManager to actor model
- `crates/forge-tauri/src/state.rs` - Update AppState to use new thread-safe terminal

**New Files to Create**:
- `crates/forge-tauri/src/terminal/actor.rs` - Terminal actor with channel-based communication
- `crates/forge-tauri/src/terminal/handle.rs` - Thread-safe handle for terminal operations

**Architecture Decision**: Use **Actor Model with Channels**

```rust
// Thread-safe handle (Send + Sync)
pub struct TerminalHandle {
    command_tx: mpsc::Sender<TerminalCommand>,
    session_id: String,
}

// Actor runs PTY operations on dedicated thread
struct TerminalActor {
    pty: PtyPair,
    command_rx: mpsc::Receiver<TerminalCommand>,
    output_tx: broadcast::Sender<TerminalOutput>,
}

// Commands sent to actor
enum TerminalCommand {
    Write(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Close,
}
```

**Why Actor Model over Arc<Mutex>**:
1. PTY operations can block - don't want to hold mutex during I/O
2. Natural fit for streaming output (broadcast channel)
3. Clean separation of concerns
4. Matches existing forge-bus event pattern

**Steps**:
1. Create `terminal/actor.rs` with TerminalActor implementation
2. Create `terminal/handle.rs` with TerminalHandle (Send + Sync)
3. Refactor TerminalManager to spawn actors and return handles
4. Update AppState to store handles instead of raw PTY
5. Update terminal IPC handlers to use new API
6. Verify thread safety with `cargo check`

**Verification**:
- [ ] `cargo build` succeeds without Send/Sync errors
- [ ] Terminal commands work via Tauri invoke
- [ ] Multiple terminals can run concurrently

---

### Phase 2: Core IPC Framework

**Objective**: Establish robust IPC patterns for all command handlers

**Files to Modify**:
- `crates/forge-tauri/src/main.rs` - Register all real command handlers
- `crates/forge-tauri/src/lib.rs` - Export command modules properly

**New Files to Create**:
- `crates/forge-tauri/src/error.rs` - Unified error handling for IPC
- `crates/forge-tauri/src/result.rs` - IPC result type with proper serialization

**Pattern to Establish**:

```rust
// Unified error type
#[derive(Debug, Serialize)]
pub struct IpcError {
    code: String,
    message: String,
    details: Option<serde_json::Value>,
}

// All commands return Result<T, IpcError>
#[tauri::command]
async fn project_add(
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Project, IpcError> {
    state.project_manager
        .add_project(&path)
        .await
        .map_err(IpcError::from)
}
```

**Steps**:
1. Create unified IpcError type with From implementations
2. Create IpcResult type alias
3. Update existing commands to use new error handling
4. Document command pattern in comments for consistency

**Verification**:
- [ ] All existing commands use unified error handling
- [ ] Frontend receives properly formatted errors
- [ ] Error details are actionable for debugging

---

### Phase 3: Project & Task Management

**Objective**: Full project and task lifecycle management

**Files to Modify**:
- `crates/forge-tauri/src/ipc/project.rs` - Implement all project methods
- `crates/forge-tauri/src/ipc/task.rs` - Implement all task methods
- `crates/forge-tauri/src/state.rs` - Ensure managers are properly initialized

**Methods to Implement** (Project - 12 methods):
- `project_list` - List all projects
- `project_add` - Add new project by path
- `project_remove` - Remove project
- `project_select` - Set active project
- `project_get_current` - Get active project
- `project_get_settings` - Get project-specific settings
- `project_set_settings` - Update project settings
- `project_get_config` - Get project config (forge.toml)
- `project_set_config` - Update project config
- `project_watch_start` - Start file watching
- `project_watch_stop` - Stop file watching
- `project_get_stats` - Get project statistics

**Methods to Implement** (Task - 15 methods):
- `task_list` - List all tasks for project
- `task_get` - Get single task by ID
- `task_create` - Create new task
- `task_update` - Update task details
- `task_delete` - Delete task
- `task_start` - Start task execution
- `task_pause` - Pause running task
- `task_resume` - Resume paused task
- `task_complete` - Mark task complete
- `task_cancel` - Cancel task
- `task_get_logs` - Get task execution logs
- `task_get_artifacts` - Get task output artifacts
- `task_assign_agent` - Assign agent to task
- `task_get_status` - Get current task status
- `task_subscribe` - Subscribe to task events

**Steps**:
1. Review existing ProjectManager and TaskManager implementations
2. Implement each project method with proper error handling
3. Implement each task method with proper error handling
4. Wire up task events to Tauri event emitter
5. Test CRUD operations end-to-end

**Verification**:
- [ ] Can create, list, update, delete projects
- [ ] Can create, list, update, delete tasks
- [ ] Task status updates emit events to frontend
- [ ] Project selection persists across restarts

---

### Phase 4: Terminal Integration

**Objective**: Full PTY terminal functionality

**Files to Modify**:
- `crates/forge-tauri/src/ipc/terminal.rs` - Implement terminal methods
- `crates/forge-tauri/src/terminal/mod.rs` - Use actor-based implementation

**Methods to Implement** (Terminal - 10 methods):
- `terminal_create` - Create new terminal session
- `terminal_list` - List active terminals
- `terminal_get` - Get terminal info
- `terminal_write` - Send input to terminal
- `terminal_resize` - Handle terminal resize
- `terminal_close` - Close terminal session
- `terminal_subscribe` - Subscribe to terminal output
- `terminal_clear` - Clear terminal buffer
- `terminal_get_history` - Get terminal scrollback
- `terminal_set_env` - Set environment variables

**Event Streaming Pattern**:

```rust
// Emit terminal output to frontend
app_handle.emit("terminal:output", TerminalOutput {
    session_id: "term-1",
    data: output_bytes,
    timestamp: Utc::now(),
})?;
```

**Steps**:
1. Implement terminal creation with actor spawning
2. Set up output streaming via Tauri events
3. Handle input routing through actor channels
4. Implement resize handling
5. Add scrollback buffer management
6. Test with real shell commands

**Verification**:
- [ ] Can spawn new terminal sessions
- [ ] Terminal output streams to frontend in real-time
- [ ] Input is properly sent to PTY
- [ ] Resize updates terminal dimensions correctly
- [ ] Multiple terminals work independently

---

### Phase 5: Worktree & Git Operations

**Objective**: Full git worktree and repository operations

**Files to Modify**:
- `crates/forge-tauri/src/ipc/worktree.rs` - Implement worktree methods
- `crates/forge-tauri/src/state.rs` - Initialize WorktreeManager on project select

**Methods to Implement** (Worktree - 14 methods):
- `worktree_status` - Get working tree status
- `worktree_diff` - Get file diffs
- `worktree_diff_staged` - Get staged diffs
- `worktree_stage` - Stage files
- `worktree_unstage` - Unstage files
- `worktree_commit` - Create commit
- `worktree_push` - Push to remote
- `worktree_pull` - Pull from remote
- `worktree_branch_list` - List branches
- `worktree_branch_create` - Create branch
- `worktree_branch_checkout` - Checkout branch
- `worktree_branch_delete` - Delete branch
- `worktree_stash` - Stash changes
- `worktree_stash_pop` - Pop stash

**Integration with forge-worktree**:
The `forge-worktree` crate already implements most git operations. Wire up IPC handlers to call existing methods.

**Steps**:
1. Initialize WorktreeManager when project is selected
2. Implement status and diff methods
3. Implement staging operations
4. Implement commit and push/pull
5. Implement branch management
6. Add file change watching for live updates

**Verification**:
- [ ] Status shows correct file states
- [ ] Diffs display properly in UI
- [ ] Can stage, commit, and push changes
- [ ] Branch operations work correctly

---

### Phase 6: Settings & Context Management

**Objective**: Full settings persistence and memory/context features

**Files to Modify**:
- `crates/forge-tauri/src/ipc/settings.rs` - Implement settings methods
- `crates/forge-tauri/src/ipc/context.rs` - Implement context/memory methods

**Methods to Implement** (Settings - 8 methods):
- `settings_get` - Get all settings
- `settings_set` - Update settings
- `settings_get_theme` - Get theme setting
- `settings_set_theme` - Set theme
- `settings_get_keybindings` - Get keybindings
- `settings_set_keybindings` - Set keybindings
- `settings_export` - Export settings to file
- `settings_import` - Import settings from file

**Methods to Implement** (Context/Memory - 10 methods):
- `context_get_episodes` - Get memory episodes
- `context_add_episode` - Add new episode
- `context_search` - Search memory
- `context_get_relevant` - Get contextually relevant episodes
- `context_clear` - Clear memory
- `context_export` - Export memory
- `context_import` - Import memory
- `context_get_stats` - Get memory statistics
- `context_prune` - Prune old/irrelevant episodes
- `context_subscribe` - Subscribe to memory updates

**Integration with forge-memory**:
The `forge-memory` crate handles vector storage and retrieval. Connect IPC handlers to existing MemoryManager.

**Steps**:
1. Implement settings CRUD with file persistence
2. Initialize MemoryManager on project selection
3. Implement memory episode management
4. Implement semantic search using existing vector store
5. Add memory event emissions

**Verification**:
- [ ] Settings persist across restarts
- [ ] Theme changes apply immediately
- [ ] Memory episodes save and retrieve correctly
- [ ] Semantic search returns relevant results

---

### Phase 7: AI Features (Roadmap, Ideation, Insights, Changelog)

**Objective**: Full AI-powered features using forge-agent

**Files to Modify**:
- `crates/forge-tauri/src/ipc/roadmap.rs` - Implement roadmap methods
- `crates/forge-tauri/src/ipc/ideation.rs` - Implement ideation methods
- `crates/forge-tauri/src/ipc/insights.rs` - Implement insights methods
- `crates/forge-tauri/src/ipc/changelog.rs` - Implement changelog methods

**Methods to Implement** (Roadmap - 8 methods):
- `roadmap_list` - List roadmap items
- `roadmap_add` - Add roadmap item
- `roadmap_update` - Update item
- `roadmap_delete` - Delete item
- `roadmap_reorder` - Reorder items
- `roadmap_generate` - AI-generate roadmap from codebase
- `roadmap_estimate` - AI-estimate effort
- `roadmap_export` - Export roadmap

**Methods to Implement** (Ideation - 8 methods):
- `ideation_list` - List ideas
- `ideation_add` - Add idea
- `ideation_update` - Update idea
- `ideation_delete` - Delete idea
- `ideation_generate` - AI-generate ideas
- `ideation_expand` - AI-expand idea into tasks
- `ideation_vote` - Vote on idea
- `ideation_export` - Export ideas

**Methods to Implement** (Insights - 6 methods):
- `insights_get` - Get project insights
- `insights_generate` - Generate new insights
- `insights_refresh` - Refresh insights
- `insights_get_dependencies` - Get dependency insights
- `insights_get_complexity` - Get complexity analysis
- `insights_export` - Export insights

**Methods to Implement** (Changelog - 6 methods):
- `changelog_list` - List changelog entries
- `changelog_add` - Add entry
- `changelog_generate` - AI-generate from commits
- `changelog_preview` - Preview generated changelog
- `changelog_publish` - Publish changelog
- `changelog_export` - Export changelog

**Architecture Decision**: These features should use forge-orchestrator to spawn specialized agents for AI operations.

**Steps**:
1. Define agent prompts for each AI feature
2. Implement data persistence for roadmap/ideation items
3. Wire up forge-orchestrator for AI generation
4. Implement streaming responses for long operations
5. Add proper caching to avoid redundant AI calls

**Verification**:
- [ ] Roadmap items CRUD works
- [ ] AI generation produces meaningful results
- [ ] Insights reflect actual codebase state
- [ ] Changelog generation parses commits correctly

---

### Phase 8: External Integrations (GitHub, Linear)

**Objective**: Connect to external services for issue/PR management

**New Files to Create**:
- `crates/forge-tauri/src/integrations/mod.rs` - Integration module
- `crates/forge-tauri/src/integrations/github.rs` - GitHub API client
- `crates/forge-tauri/src/integrations/linear.rs` - Linear API client

**Methods to Implement** (GitHub - 12 methods):
- `github_auth` - Authenticate with GitHub
- `github_issues_list` - List issues
- `github_issues_create` - Create issue
- `github_issues_update` - Update issue
- `github_issues_close` - Close issue
- `github_prs_list` - List PRs
- `github_prs_create` - Create PR
- `github_prs_merge` - Merge PR
- `github_prs_review` - Submit review
- `github_commits_list` - List commits
- `github_branches_list` - List branches
- `github_sync` - Sync local with remote

**Methods to Implement** (Linear - 10 methods):
- `linear_auth` - Authenticate with Linear
- `linear_issues_list` - List issues
- `linear_issues_create` - Create issue
- `linear_issues_update` - Update issue
- `linear_issues_transition` - Change issue state
- `linear_projects_list` - List projects
- `linear_cycles_list` - List cycles
- `linear_sync` - Sync with Linear
- `linear_link_task` - Link Forge task to Linear issue
- `linear_import` - Import issues as tasks

**Steps**:
1. Set up OAuth flows for both services
2. Implement API clients using reqwest
3. Add credential storage (secure keychain)
4. Implement sync logic
5. Wire up to frontend

**Verification**:
- [ ] OAuth flows complete successfully
- [ ] Can list and create issues/PRs
- [ ] Sync keeps data consistent
- [ ] Credentials persist securely

---

### Phase 9: Event Streaming & Real-time Updates

**Objective**: Complete event system for real-time UI updates

**Files to Modify**:
- `crates/forge-tauri/src/events.rs` - Implement full event streaming
- `crates/forge-tauri/src/main.rs` - Set up event listeners on startup

**Event Types to Implement**:
- `project:*` - Project lifecycle events
- `task:*` - Task status and progress events
- `terminal:*` - Terminal output and status
- `worktree:*` - Git status changes
- `memory:*` - Memory/context updates
- `agent:*` - Agent status and messages
- `sync:*` - External service sync events

**Integration with forge-bus**:
The existing `TokioEventBus` should be connected to Tauri's event system.

```rust
// Bridge forge-bus events to Tauri
async fn bridge_events(bus: Arc<TokioEventBus>, app: AppHandle) {
    let mut rx = bus.subscribe::<ForgeEvent>();
    while let Ok(event) = rx.recv().await {
        app.emit(&event.topic(), &event.payload())?;
    }
}
```

**Steps**:
1. Define all event types with proper serialization
2. Create event bridge between forge-bus and Tauri
3. Emit events from all command handlers where appropriate
4. Update frontend event listeners in tauri-api.ts
5. Test real-time updates in UI

**Verification**:
- [ ] Events flow from backend to frontend
- [ ] UI updates in real-time without polling
- [ ] Event subscriptions/unsubscriptions work
- [ ] No memory leaks from uncleaned subscriptions

---

### Phase 10: Frontend API Updates

**Objective**: Update tauri-api.ts to call real implementations

**Files to Modify**:
- `ui/src/lib/tauri-api.ts` - Replace stubs with real invoke calls
- `ui/src/shared/types/electron-api.ts` - Ensure type alignment

**Steps**:
1. Remove all stub implementations
2. Add invoke calls for every method
3. Set up event listeners for all event types
4. Add proper error handling and retry logic
5. Update TypeScript types to match Rust types

**Verification**:
- [ ] All API methods make real backend calls
- [ ] Type safety maintained across boundary
- [ ] Error handling works for all failure modes

---

## Testing Strategy

### Unit Tests
- Terminal actor message handling
- IPC error type conversions
- Event serialization/deserialization

### Integration Tests
- Full project lifecycle (create, select, delete)
- Task execution with agent assignment
- Terminal session management
- Git operations with real repository

### E2E Tests
- Create project via UI
- Run task and see output
- Terminal input/output flow
- Settings changes persist

### Manual Testing
- Multi-window behavior
- Performance under load
- Memory usage over time
- Error recovery scenarios

## Rollback Plan

Each phase is independently deployable:
1. Keep stub implementations as fallback
2. Feature flag new implementations
3. Git tags at each phase completion
4. If phase fails, revert to previous tag

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| PTY actor deadlock | Medium | High | Use timeout on all channel operations |
| Event flood overwhelms UI | Medium | Medium | Implement event throttling/batching |
| OAuth token expiry | Low | Medium | Implement token refresh logic |
| Memory growth from events | Medium | High | Implement bounded event history |
| AI feature latency | High | Low | Add loading states and streaming |
| Type mismatches at boundary | Medium | High | Generate types from Rust definitions |

## Open Questions

1. **AI API Keys**: Where should we store API keys for AI features? (Keychain vs config file)
2. **Event History**: How much event history should we keep in memory?
3. **Offline Mode**: Should the app work offline with cached data?
4. **Multi-project**: Support multiple projects open simultaneously?

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
