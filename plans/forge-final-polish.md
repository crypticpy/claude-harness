# Implementation Plan: Forge Final 5% Polish

Created: 2025-12-20
Status: ✅ COMPLETED

## Execution Summary

All 17 items completed successfully across 4 parallel waves:

**Wave A** (3 Opus agents in parallel):
- ✅ Phase 1A: Replaced StubAgentTools with real ForgeTools
- ✅ Phase 1B: Created ClaudeLlmAdapter for agent planning
- ✅ Phase 2A: Implemented task timeout enforcement with monitor loop

**Wave B** (3 Opus agents in parallel):
- ✅ Phase 1C: Made roadmap generation async with progress events
- ✅ Phase 2B+2C: Fixed memory field alignment (ISO timestamps) and added clear_all
- ✅ Phase 3A+3B: Added Paused status, task_resume(), and TaskMetadata

**Wave C** (3 Opus agents in parallel):
- ✅ Phase 4A+4B: Removed deprecated terminal_read, registered subscribe/unsubscribe
- ✅ Phase 4C+4D: Fixed current_iso_timestamp to RFC 3339, added usage parsing
- ✅ Phase 5A+5B: Added repo detection to github_check_connection, registered linear_issues_create

**Wave D** (1 Opus agent):
- ✅ Phase 5C: Consolidated AgentConfig into forge-types with re-exports

**Final Verification**:
- ✅ Release build passes
- ✅ All 269 forge-tauri tests pass
- ✅ Frontend build passes

---

## Summary

This plan addresses the remaining 17 items to bring Forge from 95% to 100% feature completeness. Work is organized into 5 phases with an emphasis on high polish, elegant solutions, and production-grade quality. The plan prioritizes infrastructure gaps first (which unlock agent functionality), followed by functional gaps, and concludes with polish items.

## Scope

### In Scope
- Replace StubAgentTools with real ForgeTools (infrastructure)
- Create LlmService adapter connecting to ClaudeService (infrastructure)
- Make roadmap generation async with background tasks (infrastructure)
- Add task timeout enforcement in scheduler (agent)
- Fix memory field alignment and add clear_all (memory)
- Differentiate pause vs stop for Kanban (kanban)
- Add TaskMetadata preservation (kanban)
- Remove deprecated terminal_read (terminal)
- Register terminal_subscribe/unsubscribe (terminal)
- Fix current_iso_timestamp to return ISO 8601 (claude)
- Add usage data parsing from terminal output (claude)
- Add repo detection in github_check_connection (github)
- Register linear_issues_create command (linear)
- Consolidate AgentConfig duplication (agent)

### Out of Scope
- Frontend changes (TypeScript/React)
- New features not in the 17 items
- Performance optimization beyond async generation
- Additional test coverage

## Prerequisites
- All previous waves completed (Waves 1-8)
- Release build passes
- chrono crate available (already in workspace)

---

## Phase 1: Infrastructure - Real Tools & LLM Adapter

**Objective**: Replace stubs with real implementations to enable full agent functionality.

### 1A: Replace StubAgentTools with ForgeTools

**Files to Modify**:
- `crates/forge-tauri/Cargo.toml` - Add dependencies
- `crates/forge-tauri/src/state.rs` - Replace stub with real ForgeTools

**Steps**:
1. Add dependencies to forge-tauri/Cargo.toml:
   ```toml
   forge-tools.workspace = true
   forge-store.workspace = true
   forge-profiler.workspace = true
   forge-lsp.workspace = true
   ```

2. In state.rs, remove StubAgentTools struct (lines 73-134)

3. Add ForgeTools initialization in AppState::new():
   ```rust
   // Initialize components for ForgeTools
   let store = Arc::new(forge_store::SledSymbolStore::new(&db_path)?);
   let profiler = Arc::new(forge_profiler::RustProfiler::new());
   let lsp = Arc::new(forge_lsp::NoOpLspBridge::new()); // Or real LSP if available
   let patterns = Arc::new(forge_patterns::PatternMatcher::new());

   let tools = Arc::new(ForgeTools::builder()
       .store(store)
       .profiler(profiler)
       .lsp(lsp)
       .patterns(patterns)
       .project_root(project_path)
       .build()?);
   ```

4. Pass real tools to ForgeOrchestrator::new()

5. Handle the case when no project is open (lazy initialization)

**Verification**:
- [ ] `cargo build -p forge-tauri` passes
- [ ] Agents receive real tools instead of no-ops

### 1B: Create LlmService Adapter for ClaudeService

**New Files to Create**:
- `crates/forge-tauri/src/ai/llm_adapter.rs` - Adapter implementation

**Files to Modify**:
- `crates/forge-tauri/src/ai/mod.rs` - Export adapter
- `crates/forge-tauri/src/state.rs` - Wire adapter to agents

**Steps**:
1. Create `llm_adapter.rs` with struct:
   ```rust
   pub struct ClaudeLlmAdapter {
       service: Arc<dyn AiService>,
   }

   #[async_trait]
   impl LlmService for ClaudeLlmAdapter {
       async fn analyze_requirements(&self, context: &LlmContext) -> LlmResult<RequirementsAnalysis> {
           // Build prompt from context
           // Call service.chat() with structured output
           // Parse response into RequirementsAnalysis
       }

       async fn generate_spec(&self, context: &LlmContext) -> LlmResult<ImplementationSpec> {
           // Similar pattern
       }

       async fn critique_spec(&self, context: &LlmContext, spec: &ImplementationSpec) -> LlmResult<SpecCritique> {
           // Similar pattern
       }

       fn is_configured(&self) -> bool {
           self.service.is_configured()
       }

       fn estimate_tokens(&self, text: &str) -> usize {
           text.len() / 4 // Simple heuristic
       }
   }
   ```

2. Add structured prompts for each operation (JSON output format)

3. Wire adapter in AppState, inject into agent contexts

**Verification**:
- [ ] `cargo build -p forge-tauri` passes
- [ ] Agent planning phases can call real AI

### 1C: Async Roadmap Generation with Background Tasks

**Files to Modify**:
- `crates/forge-tauri/src/ipc/roadmap.rs` - Add background task spawning

**Steps**:
1. Create a RoadmapGenerationTask struct to hold generation state

2. Modify `roadmap_generate()` to:
   - Return immediately with generation ID
   - Spawn tokio task for actual generation
   - Emit progress events during generation
   - Store result when complete

3. Add `roadmap_get_generation_status()` to check progress

4. Use existing GenerationProgress events from Wave 2

**Verification**:
- [ ] Generation runs in background
- [ ] UI receives progress events
- [ ] Result available after completion

---

## Phase 2: Agent & Memory Gaps

**Objective**: Complete agent timeout enforcement and memory API.

### 2A: Task Timeout Enforcement in Scheduler

**Files to Modify**:
- `crates/forge-orchestrator/src/scheduler.rs` - Add timeout monitoring
- `crates/forge-orchestrator/src/pool.rs` - Cancel timed-out agents

**Steps**:
1. Add `started_at: Option<Instant>` to task tracking

2. Create timeout monitor task in scheduler:
   ```rust
   async fn monitor_timeouts(&self) {
       loop {
           tokio::time::sleep(Duration::from_secs(10)).await;
           let now = Instant::now();
           for (task_id, task) in self.active_tasks.iter() {
               if let (Some(started), Some(timeout)) = (task.started_at, task.timeout) {
                   if now.duration_since(started) > timeout {
                       self.cancel_task(*task_id, "Timeout exceeded").await;
                   }
               }
           }
       }
   }
   ```

3. Start monitor when orchestrator starts

4. Emit TaskError event on timeout

**Verification**:
- [ ] Tasks with timeout are monitored
- [ ] Timed-out tasks are cancelled
- [ ] Events emitted for timeouts

### 2B: Memory Field Alignment

**Files to Modify**:
- `crates/forge-tauri/src/ipc/types.rs` - Align MemoryEpisode with frontend
- `crates/forge-tauri/src/ipc/context.rs` - Update conversion

**Steps**:
1. Update MemoryEpisode struct to match frontend:
   ```rust
   #[derive(Debug, Clone, Serialize, Deserialize)]
   pub struct MemoryEpisode {
       pub id: String,
       #[serde(rename = "type")]
       pub episode_type: String,
       pub content: String,
       pub timestamp: String,  // ISO 8601 string
       pub session_number: Option<u32>,
       pub score: Option<f32>,
   }
   ```

2. Update `convert_episode()` to map fields correctly

3. Use proper ISO timestamp format

**Verification**:
- [ ] Frontend receives correct field names
- [ ] Serialization matches TypeScript types

### 2C: Full Memory Clear Implementation

**Files to Modify**:
- `crates/forge-memory/src/manager.rs` - Add clear_all method
- `crates/forge-memory/src/store.rs` - Add store-level clear
- `crates/forge-tauri/src/ipc/context.rs` - Wire to IPC

**Steps**:
1. Add to MemoryStore trait:
   ```rust
   async fn clear_all(&self) -> MemoryResult<()>;
   ```

2. Implement in SledMemoryStore:
   ```rust
   async fn clear_all(&self) -> MemoryResult<()> {
       self.db.clear()?;
       Ok(())
   }
   ```

3. Add to MemoryManager:
   ```rust
   pub async fn clear_all(&self) -> MemoryResult<()> {
       self.store.clear_all().await
   }
   ```

4. Update `context_clear()` to use clear_all when no spec_id provided

**Verification**:
- [ ] Full clear works from CLI
- [ ] Full clear works from IPC

---

## Phase 3: Kanban Polish

**Objective**: Differentiate pause/stop and preserve metadata.

### 3A: Differentiate Pause vs Stop

**Files to Modify**:
- `crates/forge-tauri/src/ipc/types.rs` - Add Paused status
- `crates/forge-tauri/src/ipc/task.rs` - Implement distinct behaviors

**Steps**:
1. Add `Paused` variant to TaskStatus enum:
   ```rust
   pub enum TaskStatus {
       Backlog,
       InProgress,
       Paused,      // NEW
       InReview,
       Done,
       Blocked,
       Cancelled,
   }
   ```

2. Update `task_pause()`:
   ```rust
   // Set status to Paused (not Backlog)
   task.status = TaskStatus::Paused;
   // Preserve assigned_to and progress
   // Emit TaskStatusChange with "paused"
   ```

3. Update `task_resume()` (or create if missing):
   ```rust
   // Only works from Paused status
   // Restore to InProgress
   // Resume orchestrator task if needed
   ```

4. Keep `task_stop()` returning to Backlog (full stop)

**Verification**:
- [ ] Pause preserves assignment and progress
- [ ] Stop clears assignment
- [ ] Resume works from paused state

### 3B: TaskMetadata Preservation

**Files to Modify**:
- `crates/forge-tauri/src/ipc/types.rs` - Add TaskMetadata struct
- `crates/forge-tauri/src/ipc/task.rs` - Update CreateTaskRequest

**Steps**:
1. Add TaskMetadata struct matching frontend:
   ```rust
   #[derive(Debug, Clone, Serialize, Deserialize, Default)]
   pub struct TaskMetadata {
       pub source_type: Option<String>,
       pub category: Option<String>,
       pub complexity: Option<String>,
       pub impact: Option<String>,
       pub rationale: Option<String>,
       pub affected_files: Option<Vec<String>>,
       pub dependencies: Option<Vec<String>>,
       pub acceptance_criteria: Option<Vec<String>>,
       pub agent_model: Option<String>,
       pub thinking_level: Option<String>,
       // ... other fields as needed
   }
   ```

2. Add to CreateTaskRequest:
   ```rust
   pub metadata: Option<TaskMetadata>,
   ```

3. Add to Task struct:
   ```rust
   pub metadata: Option<TaskMetadata>,
   ```

4. Preserve metadata through task lifecycle

**Verification**:
- [ ] Metadata passed from frontend is stored
- [ ] Metadata returned in task queries

---

## Phase 4: Terminal & Claude Polish

**Objective**: Clean up deprecated code and fix timestamp format.

### 4A: Remove Deprecated terminal_read

**Files to Modify**:
- `crates/forge-tauri/src/ipc/terminal.rs` - Remove function

**Steps**:
1. Delete `terminal_read()` function (lines 730-759)
2. Verify no callers exist (grep for terminal_read)
3. Remove any related tests

**Verification**:
- [ ] Function removed
- [ ] Build passes
- [ ] No broken imports

### 4B: Register terminal_subscribe/unsubscribe

**Files to Modify**:
- `crates/forge-tauri/src/main.rs` - Add wrappers and registration

**Steps**:
1. Add wrapper functions:
   ```rust
   #[tauri::command]
   async fn terminal_subscribe(
       state: State<'_, Arc<AppState>>,
       terminal_id: String,
       app: AppHandle,
       registry: State<'_, TerminalSubscriptionRegistry>,
   ) -> IpcResult<bool> {
       ipc::terminal_subscribe(&state, terminal_id, app, &registry).await.into_ipc()
   }

   #[tauri::command]
   async fn terminal_unsubscribe(
       terminal_id: String,
       registry: State<'_, TerminalSubscriptionRegistry>,
   ) -> IpcResult<bool> {
       ipc::terminal_unsubscribe(terminal_id, &registry).await.into_ipc()
   }
   ```

2. Add to invoke_handler! macro

**Verification**:
- [ ] Commands callable from frontend
- [ ] Subscription management works

### 4C: Fix current_iso_timestamp

**Files to Modify**:
- `crates/forge-tauri/src/ipc/claude/helpers.rs` - Fix timestamp format

**Steps**:
1. Update function to use chrono:
   ```rust
   use chrono::Utc;

   pub fn current_iso_timestamp() -> String {
       Utc::now().to_rfc3339()
   }
   ```

2. Add chrono to Cargo.toml if not present

**Verification**:
- [ ] Returns ISO 8601 format like "2025-12-20T14:30:00Z"
- [ ] All callers work correctly

### 4D: Usage Data Parsing

**Files to Modify**:
- `crates/forge-tauri/src/ipc/claude/usage_handlers.rs` - Add parsing

**Steps**:
1. Create usage output parser:
   ```rust
   fn parse_usage_output(output: &str) -> Option<ClaudeUsageData> {
       // Parse lines like:
       // "Session usage: 45%"
       // "Weekly usage: 23%"
       // "Resets in: 4h 30m"
       // Extract percentages and time
   }
   ```

2. Add event listener for terminal output

3. Update usage when parsed

**Verification**:
- [ ] Usage data populated from terminal
- [ ] Updates reflect in UI

---

## Phase 5: Integration Polish

**Objective**: Complete GitHub and Linear integrations, consolidate configs.

### 5A: Repo Detection in github_check_connection

**Files to Modify**:
- `crates/forge-tauri/src/integrations/github/project.rs` - Add detection

**Steps**:
1. Update `github_check_connection()`:
   ```rust
   pub async fn github_check_connection(
       state: &AppState,
       project_id: String,
   ) -> IpcResult<GitHubConnectionStatus> {
       // Check auth first
       if !is_authenticated() {
           return Ok(GitHubConnectionStatus { connected: false, repo: None, error: None });
       }

       // Try to detect repo from project
       let repo = github_detect_repo(state, project_id).await.ok();

       Ok(GitHubConnectionStatus {
           connected: true,
           repo,
           error: None,
       })
   }
   ```

**Verification**:
- [ ] Connection check returns repo name
- [ ] Works for git-based projects

### 5B: Register linear_issues_create

**Files to Modify**:
- `crates/forge-tauri/src/main.rs` - Add wrapper and registration

**Steps**:
1. Add wrapper:
   ```rust
   #[tauri::command]
   async fn linear_issues_create(
       state: State<'_, Arc<AppState>>,
       request: CreateLinearIssueRequest,
   ) -> IpcResult<LinearIssue> {
       integrations::linear_issues_create(&state, request).await.into_ipc()
   }
   ```

2. Add to invoke_handler! macro

**Verification**:
- [ ] Can create Linear issues from frontend
- [ ] Returns created issue

### 5C: Consolidate AgentConfig

**Files to Modify**:
- `crates/forge-types/src/config.rs` - Create unified config (new file)
- `crates/forge-agent/src/context.rs` - Use unified config
- `crates/forge-orchestrator/src/types.rs` - Use unified config
- `crates/forge-config/src/config.rs` - Deprecate old config

**Steps**:
1. Create unified AgentConfig in forge-types:
   ```rust
   #[derive(Debug, Clone, Serialize, Deserialize)]
   pub struct AgentConfig {
       // Identity
       pub name: Option<String>,
       pub ephemeral: bool,

       // Concurrency
       pub max_concurrent_tasks: usize,
       pub max_subtasks: usize,

       // Timeouts
       pub operation_timeout: Duration,
       pub claim_timeout: Duration,
       pub peer_timeout: Duration,

       // Retries
       pub max_retries: u32,
       pub retry_delay: Duration,

       // Limits
       pub max_file_size: usize,
       pub checkpoint_interval: Duration,

       // Debug
       pub verbose: bool,
       pub working_dir: Option<PathBuf>,
   }
   ```

2. Add conversion methods for backwards compatibility

3. Update forge-agent and forge-orchestrator to use unified type

4. Deprecate old configs with `#[deprecated]`

**Verification**:
- [ ] Single source of truth for agent config
- [ ] Old code still compiles with deprecation warnings

---

## Testing Strategy

### Unit Tests
- Test timeout enforcement with mock tasks
- Test memory clear_all
- Test ISO timestamp format
- Test usage parsing with sample outputs

### Integration Tests
- Test agent planning with real LLM adapter
- Test roadmap async generation
- Test pause/resume cycle

### Manual Testing
- Verify repo detection in GitHub panel
- Verify Linear issue creation
- Verify usage data updates

---

## Rollback Plan

Each phase is independent:
1. **Phase 1**: Revert to StubAgentTools if ForgeTools fails
2. **Phase 2**: Timeout monitoring can be disabled via config
3. **Phase 3**: Status changes are backwards compatible
4. **Phase 4**: Terminal changes are non-breaking
5. **Phase 5**: Integration changes have fallbacks

Git commits should be atomic per phase for easy reversion.

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| ForgeTools requires unavailable components | Medium | High | Lazy init, graceful fallback to stub |
| LLM adapter prompts need tuning | Medium | Medium | Use mock for testing, iterate on prompts |
| Async generation races with UI | Low | Medium | Use generation IDs, status checks |
| Timeout cancellation disrupts work | Low | High | Generous default timeout, clear messaging |
| Config consolidation breaks imports | Medium | Low | Deprecation warnings, re-exports |

---

## Parallel Execution Strategy

**Wave A** (Parallel - 3 Opus agents):
- Phase 1A: ForgeTools integration
- Phase 1B: LlmService adapter
- Phase 2A: Task timeout enforcement

**Wave B** (Parallel - 3 Opus agents):
- Phase 1C: Async roadmap generation
- Phase 2B + 2C: Memory gaps (combined)
- Phase 3A + 3B: Kanban gaps (combined)

**Wave C** (Parallel - 3 Opus agents):
- Phase 4A + 4B: Terminal cleanup (combined)
- Phase 4C + 4D: Claude fixes (combined)
- Phase 5A + 5B: Integration polish (combined)

**Wave D** (Single agent):
- Phase 5C: AgentConfig consolidation (touches multiple crates)

**Final**: Integration testing and verification

---

**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
