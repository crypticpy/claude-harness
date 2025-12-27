# Implementation Plan: Complete All Forge Audit Gaps

Created: 2025-12-20
Status: ✅ COMPLETED
Approved: 2025-12-20 by User
Completed: 2025-12-20

## Execution Summary

All 8 waves completed successfully using parallel Opus agents:
- **Wave 1**: 4 quick fixes (register commands, github_get_issues, github_import_issues, OAuth token)
- **Wave 2**: 3 event system implementations (Kanban, AI generation, GitHub)
- **Wave 3**: 2 changelog completions (8 IPC commands, persistence + API alignment)
- **Wave 4**: 2 roadmap completions (5 commands, persistence)
- **Wave 5**: 2 insights completions (AiService chat, streaming + health analysis)
- **Wave 6**: 2 polish items (ideation async stop, terminal buffer replay)
- **Wave 7**: 3 agent workflow (LLM integration, ForgeAgent wiring, pause/resume)
- **Wave 8**: Build verification + web build

**Total agents deployed**: 20 Opus agents across 8 waves
**Build status**: Release build passes
**Test status**: All tests pass
**Frontend**: TypeScript compiles, Vite build successful

Note: Execute all waves continuously, use parallel Opus agents, test with browser automation, build web version when complete.

## Summary

This plan addresses all 47 gaps identified in the traceability audit, bringing Forge from 76% to 100% feature completeness. Work is organized into 7 waves using parallel Opus agents where possible, with dependencies respected between waves. The goal is production-ready implementation of all features including Changelog, Roadmap, Insights, GitHub, Ideation, and Agent Workflow.

## Scope

### In Scope
- All 7 critical gaps (must fix)
- All 7 high priority gaps
- All 9 medium priority gaps
- Quality-of-life improvements for feature completeness
- Persistence layers where missing
- Event propagation system
- LLM integration for agent phases

### Out of Scope
- Frontend React/TypeScript changes (backend-only focus)
- New features not identified in audit
- Performance optimization (separate effort)
- Test suite expansion (separate effort)

## Prerequisites
- Audit reports in `/docs/audits/`
- Rust toolchain installed
- Access to forge-tauri, forge-agent, forge-orchestrator crates

---

## Wave 1: Quick Fixes (Parallel - 4 Agents)

**Objective**: Fix all low-effort, high-impact gaps immediately. Moves completeness from 76% → 85%.

### Agent 1A: Register Missing Tauri Commands

**Files to Modify**:
- `crates/forge-tauri/src/main.rs` - Add to invoke_handler! macro

**Steps**:
1. Find the `invoke_handler!` macro (around line 1550+)
2. Add missing roadmap commands:
   ```rust
   roadmap_update_feature_status,
   roadmap_add_phase,
   roadmap_add_feature,
   roadmap_remove_feature,
   ```
3. Add missing linear command:
   ```rust
   linear_auth_callback,
   ```
4. Add missing ideation command:
   ```rust
   ideation_delete_multiple,
   ```

**Verification**:
- [ ] `cargo build -p forge-tauri` passes
- [ ] All 6 commands appear in invoke_handler!

**Fixes**: ROADMAP-02, LINEAR-01, IDEATION-02

---

### Agent 1B: Implement github_get_issues

**Files to Modify**:
- `crates/forge-tauri/src/integrations/github/project.rs`

**Steps**:
1. Read the existing `github_issues_list()` in `api.rs` for reference
2. Replace the stub in `github_get_issues()` (line ~104-126):
   ```rust
   pub async fn github_get_issues(
       state: &AppState,
       project_id: String,
       issue_state: Option<String>,
   ) -> IpcResult<Vec<GitHubIssue>> {
       let manager = state.github_manager();

       // Get token (OAuth first, then CLI fallback)
       let token = if let Some(t) = manager.get_token() {
           t
       } else {
           let cli_result = github_get_token(state).await?;
           cli_result.token.ok_or_else(|| IpcError::not_authenticated("GitHub"))?
       };

       // Detect repository from project
       let project = state.project_manager().get(&project_id)?
           .ok_or_else(|| IpcError::not_found("Project", &project_id))?;
       let repo_info = github_detect_repo(state, project_id.clone()).await?;
       let (owner, repo) = parse_and_validate_owner_repo(&repo_info.full_name)?;

       // Use existing API function
       let request = ListIssuesRequest {
           owner,
           repo,
           state: issue_state,
           ..Default::default()
       };

       github_issues_list(state, request).await
   }
   ```
3. Import required types at top of file

**Verification**:
- [ ] `cargo build -p forge-tauri` passes
- [ ] `cargo test -p forge-tauri github` passes

**Fixes**: GITHUB-01

---

### Agent 1C: Implement github_import_issues

**Files to Modify**:
- `crates/forge-tauri/src/integrations/github/project.rs`

**Steps**:
1. Find `github_import_issues()` stub (line ~229-254)
2. Implement proper issue import:
   ```rust
   pub async fn github_import_issues(
       state: &AppState,
       project_id: String,
       issue_numbers: Vec<u32>,
   ) -> IpcResult<Vec<ImportResult>> {
       let mut results = Vec::new();

       for issue_num in issue_numbers {
           // Fetch issue details
           let issue = github_get_issue(state, project_id.clone(), issue_num).await?;

           // Create task from issue
           let task = Task {
               id: TaskId::new(),
               title: issue.title.clone(),
               description: Some(issue.body.unwrap_or_default()),
               status: TaskStatus::Backlog,
               priority: TaskPriority::Medium,
               source: Some(TaskSource::GitHub {
                   issue_number: issue_num,
                   url: issue.html_url.clone(),
               }),
               created_at: Utc::now(),
               ..Default::default()
           };

           // Add to task manager
           state.task_manager().add_task(&project_id, task.clone())?;

           results.push(ImportResult {
               issue_number: issue_num,
               task_id: Some(task.id.to_string()),
               success: true,
               error: None,
           });
       }

       Ok(results)
   }
   ```
3. Add `ImportResult` struct if not exists
4. Import task creation types

**Verification**:
- [ ] `cargo build -p forge-tauri` passes
- [ ] Import creates tasks in Kanban

**Fixes**: GITHUB-02

---

### Agent 1D: Pass OAuth Token to Claude CLI

**Files to Modify**:
- `crates/forge-tauri/src/ipc/terminal.rs`

**Steps**:
1. Find `terminal_invoke_claude()` function (line ~1189-1250)
2. After getting active profile, pass token:
   ```rust
   // Get active profile for OAuth token
   let profile_manager = state.claude_profile_manager();
   let active_profile = profile_manager.get_active_profile()?;

   // Build command with OAuth token if available
   let mut command = "claude".to_string();
   if let Some(profile) = active_profile {
       if let Some(token) = profile_manager.get_token_for_profile(&profile.id)? {
           command.push_str(&format!(" --oauth-token={}", token));
       }
   }

   // Append prompt if provided
   if let Some(prompt) = prompt {
       command.push_str(&format!(" \"{}\"", prompt.replace("\"", "\\\"")));
   }
   ```
3. Same for `terminal_resume_claude()` function

**Verification**:
- [ ] `cargo build -p forge-tauri` passes
- [ ] Terminal invokes Claude with profile token

**Fixes**: TERMINAL-01

---

## Wave 2: Event System (Parallel - 3 Agents)

**Objective**: Implement missing event propagation from backend to frontend.

### Agent 2A: Kanban Task Events

**Files to Modify**:
- `crates/forge-tauri/src/ipc/task.rs`
- `crates/forge-tauri/src/events.rs` (add event types)

**Steps**:
1. Add task event types to ForgeEvent enum:
   ```rust
   TaskProgress { task_id: String, progress: f32, message: String },
   TaskError { task_id: String, error: String },
   TaskStatusChange { task_id: String, old_status: String, new_status: String },
   TaskLogEntry { task_id: String, phase: String, message: String },
   ```
2. In `task_start()`, emit TaskStatusChange event
3. In `task_stop()`, emit TaskStatusChange event
4. Add progress emission points in task execution
5. Ensure EventBridge forwards these to Tauri

**Verification**:
- [ ] Events emitted on task state changes
- [ ] Frontend receives events (check Tauri devtools)

**Fixes**: KANBAN-01

---

### Agent 2B: AI Generation Progress Events

**Files to Modify**:
- `crates/forge-tauri/src/ipc/roadmap.rs`
- `crates/forge-tauri/src/ipc/ideation.rs`
- `crates/forge-tauri/src/ipc/changelog.rs`
- `crates/forge-tauri/src/events.rs`

**Steps**:
1. Add generation event types:
   ```rust
   RoadmapProgress { roadmap_id: String, phase: String, progress: f32 },
   RoadmapComplete { roadmap_id: String },
   RoadmapError { roadmap_id: String, error: String },
   IdeationProgress { project_id: String, type_name: String, count: u32 },
   IdeationComplete { project_id: String },
   ChangelogProgress { version: String, progress: f32 },
   ChangelogComplete { version: String },
   ```
2. Refactor generation functions to emit progress
3. Add `stopped` events for cancellation

**Verification**:
- [ ] Progress events during AI generation
- [ ] Frontend progress bars update

**Fixes**: ROADMAP-03 (partial), event infrastructure for all AI features

---

### Agent 2C: GitHub Investigation Progress Events

**Files to Modify**:
- `crates/forge-tauri/src/integrations/github/project.rs`
- `crates/forge-tauri/src/events.rs`

**Steps**:
1. Add investigation event types:
   ```rust
   GitHubInvestigationProgress { issue_number: u32, phase: String, progress: f32 },
   GitHubInvestigationComplete { issue_number: u32, recommendations: Vec<String> },
   ```
2. In `github_investigate_issue()`, emit progress at each analysis step
3. Forward events to Tauri

**Verification**:
- [ ] Investigation progress visible in UI

**Fixes**: GITHUB-04

---

## Wave 3: Changelog Complete (Parallel - 2 Agents)

**Objective**: Implement all 8 missing changelog IPC commands and persistence.

### Agent 3A: Changelog Core Commands

**Files to Modify**:
- `crates/forge-tauri/src/ipc/changelog.rs`
- `crates/forge-tauri/src/main.rs` (register commands)

**New Commands to Implement**:
1. `changelog_save` - Write to CHANGELOG.md file
2. `changelog_read_existing` - Parse existing CHANGELOG.md
3. `changelog_suggest_version` - Suggest next version based on tasks
4. `changelog_get_done_tasks` - Get completed tasks for changelog

**Steps**:
1. Implement `changelog_save()`:
   ```rust
   pub async fn changelog_save(
       state: &AppState,
       project_id: String,
       content: String,
       version: String,
   ) -> IpcResult<()> {
       let project = state.project_manager().get(&project_id)?
           .ok_or_else(|| IpcError::not_found("Project", &project_id))?;
       let changelog_path = project.path.join("CHANGELOG.md");

       // Prepend new version to existing changelog
       let existing = fs::read_to_string(&changelog_path).unwrap_or_default();
       let new_content = format!("## [{}] - {}\n\n{}\n\n{}",
           version, chrono::Utc::now().format("%Y-%m-%d"), content, existing);

       fs::write(&changelog_path, new_content)?;
       Ok(())
   }
   ```
2. Implement `changelog_read_existing()` with Markdown parsing
3. Implement `changelog_suggest_version()` using semantic versioning
4. Implement `changelog_get_done_tasks()` from task manager

**Verification**:
- [ ] `cargo build -p forge-tauri` passes
- [ ] Can save CHANGELOG.md to disk

**Fixes**: CHANGELOG-01 (partial)

---

### Agent 3B: Changelog Git Commands

**Files to Modify**:
- `crates/forge-tauri/src/ipc/changelog.rs`
- `crates/forge-tauri/src/main.rs`

**New Commands to Implement**:
1. `changelog_suggest_version_from_commits` - Analyze git commits
2. `changelog_get_branches` - List branches for selection
3. `changelog_get_tags` - List tags for version reference
4. `changelog_get_commits_preview` - Preview commits in range
5. `changelog_save_image` - Save embedded image

**Steps**:
1. Implement `changelog_get_commits_preview()`:
   ```rust
   pub async fn changelog_get_commits_preview(
       state: &AppState,
       project_id: String,
       from_ref: Option<String>,
       to_ref: Option<String>,
   ) -> IpcResult<Vec<CommitInfo>> {
       // Use git log to get commits
       let output = tokio::process::Command::new("git")
           .args(["log", "--oneline", &format!("{}..{}",
               from_ref.unwrap_or("HEAD~20".into()),
               to_ref.unwrap_or("HEAD".into())
           )])
           .current_dir(&project.path)
           .output()
           .await?;

       // Parse output into CommitInfo structs
       parse_git_log_output(&output.stdout)
   }
   ```
2. Implement remaining git-related commands
3. Add persistence to save changelog state

**Verification**:
- [ ] Git commands work in project directory
- [ ] Commits parsed correctly

**Fixes**: CHANGELOG-01 (complete), CHANGELOG-03

---

## Wave 4: Roadmap Complete (Parallel - 2 Agents)

**Objective**: Implement 5 missing roadmap commands and add persistence.

### Agent 4A: Roadmap Missing Commands

**Files to Modify**:
- `crates/forge-tauri/src/ipc/roadmap.rs`
- `crates/forge-tauri/src/main.rs`

**New Commands to Implement**:
1. `roadmap_get_status` - Get generation status
2. `roadmap_refresh` - Regenerate with updated context
3. `roadmap_stop` - Cancel ongoing generation
4. `roadmap_save` - Persist to disk
5. `roadmap_convert_feature_to_spec` - Create task from feature

**Steps**:
1. Add generation state tracking:
   ```rust
   struct RoadmapGenerationState {
       is_generating: bool,
       current_phase: Option<String>,
       progress: f32,
       cancel_token: Option<CancellationToken>,
   }
   ```
2. Implement each command with proper state management
3. Add cancellation support for `roadmap_stop()`
4. Implement feature-to-task conversion

**Verification**:
- [ ] Can start/stop generation
- [ ] Status reflects current state

**Fixes**: ROADMAP-01

---

### Agent 4B: Roadmap Persistence + Async

**Files to Modify**:
- `crates/forge-tauri/src/ipc/roadmap.rs`

**Steps**:
1. Create RoadmapStore for persistence:
   ```rust
   struct RoadmapStore {
       path: PathBuf, // ~/.forge/roadmaps/
   }

   impl RoadmapStore {
       fn save(&self, roadmap: &Roadmap) -> Result<()>;
       fn load(&self, id: &str) -> Result<Option<Roadmap>>;
       fn list(&self, project_id: &str) -> Result<Vec<Roadmap>>;
       fn delete(&self, id: &str) -> Result<()>;
   }
   ```
2. Refactor `roadmap_generate()` to async background task:
   ```rust
   pub async fn roadmap_generate(...) -> IpcResult<String> {
       // Start background task
       let task = tokio::spawn(async move {
           // Emit progress events
           emit_event(RoadmapProgress { phase: "analyzing", progress: 0.1 });

           // Call AI service
           let result = ai_service.generate_roadmap(&context).await;

           // Save to disk
           roadmap_store.save(&result);

           // Emit completion
           emit_event(RoadmapComplete { roadmap_id: result.id });
       });

       // Return immediately with roadmap ID
       Ok(roadmap_id)
   }
   ```
3. Add cancellation token support

**Verification**:
- [ ] Roadmaps persist across restarts
- [ ] Generation doesn't block UI

**Fixes**: ROADMAP-03, ROADMAP-04

---

## Wave 5: Insights Complete (Parallel - 2 Agents)

**Objective**: Connect insights chat to AI service with streaming.

### Agent 5A: Connect Insights Chat to AiService

**Files to Modify**:
- `crates/forge-tauri/src/ipc/insights.rs`

**Steps**:
1. Find `insights_send_message()` (line ~1331)
2. Replace NotImplemented with actual implementation:
   ```rust
   pub async fn insights_send_message(
       state: &AppState,
       session_id: String,
       message: String,
   ) -> IpcResult<()> {
       let ai_service = state.ai_service();

       // Get session context
       let session = state.insights_manager().get_session(&session_id)?;
       let project_context = build_project_context(&session)?;

       // Build chat messages
       let messages = session.messages.iter()
           .map(|m| ChatMessage { role: m.role.clone(), content: m.content.clone() })
           .chain(std::iter::once(ChatMessage { role: "user".into(), content: message }))
           .collect();

       // Call AI service
       let response = ai_service.chat(messages, project_context).await?;

       // Add to session
       state.insights_manager().add_message(&session_id, "assistant", &response)?;

       // Emit completion event
       emit_event(InsightsMessageComplete { session_id, content: response });

       Ok(())
   }
   ```
3. Add project context building helper
4. Emit streaming events

**Verification**:
- [ ] Chat messages get AI responses
- [ ] Session history preserved

**Fixes**: INSIGHT-01

---

### Agent 5B: Insights Streaming + Health

**Files to Modify**:
- `crates/forge-tauri/src/ipc/insights.rs`
- `crates/forge-tauri/src/ai/service.rs`

**Steps**:
1. Add streaming chat support:
   ```rust
   pub async fn insights_send_message_streaming(
       state: &AppState,
       session_id: String,
       message: String,
   ) -> IpcResult<()> {
       // Start streaming in background
       tokio::spawn(async move {
           let stream = ai_service.chat_stream(messages).await?;

           while let Some(chunk) = stream.next().await {
               emit_event(InsightsStreamChunk {
                   session_id: session_id.clone(),
                   content: chunk
               });
           }

           emit_event(InsightsStreamComplete { session_id });
       });

       Ok(())
   }
   ```
2. Implement `insights_health()` with real analysis:
   ```rust
   pub async fn insights_health(state: &AppState, project_id: String) -> IpcResult<HealthReport> {
       let ai_service = state.ai_service();

       // Gather project stats
       let stats = gather_project_stats(&project_id)?;

       // Use AI to analyze if configured
       if ai_service.is_configured() {
           let analysis = ai_service.analyze_project_health(&stats).await?;
           return Ok(analysis);
       }

       // Fallback to heuristic-based health
       Ok(calculate_heuristic_health(&stats))
   }
   ```

**Verification**:
- [ ] Streaming chunks appear in UI
- [ ] Health scores calculated

**Fixes**: INSIGHT-02, INSIGHT-03

---

## Wave 6: Ideation + Terminal Polish (Parallel - 2 Agents)

**Objective**: Fix remaining ideation and terminal gaps.

### Agent 6A: Ideation Async Stop

**Files to Modify**:
- `crates/forge-tauri/src/ipc/ideation.rs`

**Steps**:
1. Add generation state tracking:
   ```rust
   struct IdeationState {
       is_generating: AtomicBool,
       cancel_token: Option<CancellationToken>,
   }
   ```
2. Refactor `ideation_generate()` to background task with cancellation:
   ```rust
   pub async fn ideation_generate(...) -> IpcResult<String> {
       let cancel_token = CancellationToken::new();
       state.ideation_manager().set_cancel_token(cancel_token.clone());

       tokio::spawn(async move {
           select! {
               result = generate_ideas_impl() => { /* handle result */ }
               _ = cancel_token.cancelled() => {
                   emit_event(IdeationStopped { project_id });
               }
           }
       });

       Ok(generation_id)
   }
   ```
3. Implement `ideation_stop()` properly:
   ```rust
   pub async fn ideation_stop(state: &AppState, project_id: String) -> IpcResult<()> {
       if let Some(token) = state.ideation_manager().take_cancel_token(&project_id) {
           token.cancel();
       }
       Ok(())
   }
   ```

**Verification**:
- [ ] Stop button cancels generation
- [ ] Stopped event emitted

**Fixes**: IDEATION-01

---

### Agent 6B: Terminal Buffer Replay

**Files to Modify**:
- `crates/forge-tauri/src/terminal/session_store.rs`
- `crates/forge-tauri/src/ipc/terminal.rs`

**Steps**:
1. In `terminal_restore_session()`, implement buffer replay:
   ```rust
   pub async fn terminal_restore_session(
       state: &AppState,
       session_id: String,
   ) -> IpcResult<TerminalRestoreResult> {
       let saved = state.terminal_session_store().get(&session_id)?;

       // Create new terminal with saved dimensions
       let new_session = terminal_create_with_size(
           state, saved.cwd, saved.cols, saved.rows
       ).await?;

       // Replay buffer if available
       if let Some(buffer) = saved.buffer {
           let decoded = base64::decode(&buffer)?;

           // Write buffer to terminal output channel (display only, not to PTY)
           let handle = state.terminal_manager().get(&new_session.id)?;
           handle.replay_buffer(&decoded)?;
       }

       Ok(TerminalRestoreResult {
           old_session_id: session_id,
           new_session_id: new_session.id,
           buffer_restored: saved.buffer.is_some(),
       })
   }
   ```
2. Add `replay_buffer()` to TerminalHandle
3. Ensure buffer sent to frontend via events

**Verification**:
- [ ] Restored terminal shows previous content
- [ ] New PTY is functional

**Fixes**: TERMINAL-02

---

## Wave 7: Agent Workflow (Sequential - 3 Agents)

**Objective**: Complete agent execution with LLM integration.

**Note**: These must run sequentially due to dependencies.

### Agent 7A: LLM Integration for Planning Phases

**Files to Modify**:
- `crates/forge-agent/src/phases.rs`

**Steps**:
1. Add `AiService` to `PhaseExecutor`:
   ```rust
   pub struct PhaseExecutor {
       ai_service: Arc<dyn AiService>,
       tools: Arc<dyn AgentTools>,
   }
   ```
2. Implement `execute_requirements()`:
   ```rust
   async fn execute_requirements(&self, task: &Task) -> Result<RequirementsOutput> {
       let prompt = build_requirements_prompt(task);
       let response = self.ai_service.chat(vec![
           ChatMessage::system(REQUIREMENTS_SYSTEM_PROMPT),
           ChatMessage::user(prompt),
       ]).await?;

       parse_requirements_response(&response)
   }
   ```
3. Implement `execute_spec_writing()` with AI
4. Implement `execute_spec_critique()` with AI
5. Add prompts for each phase in new `prompts.rs`

**Verification**:
- [ ] Planning phases produce real output
- [ ] AI responses parsed correctly

**Fixes**: AGENT-01

---

### Agent 7B: Wire ForgeAgent to AgentPool

**Files to Modify**:
- `crates/forge-orchestrator/src/pool.rs`
- `crates/forge-orchestrator/src/orchestrator.rs`

**Steps**:
1. Replace placeholder agent loop with real ForgeAgent:
   ```rust
   pub async fn spawn(&self, config: AgentConfig) -> Result<AgentId> {
       let agent_id = self.next_id.fetch_add(1, Ordering::SeqCst);

       // Create real ForgeAgent
       let agent = ForgeAgent::new(
           agent_id,
           config,
           self.tools.clone(),
           self.bus.clone(),
       );

       // Create handle for communication
       let (handle, inbox) = AgentHandle::new(agent_id);

       // Spawn agent run loop
       let join_handle = tokio::spawn(async move {
           agent.run(inbox).await
       });

       self.agents.insert(agent_id, handle);
       self.join_handles.insert(agent_id, join_handle);

       Ok(agent_id)
   }
   ```
2. Update message routing to use real agent handles
3. Connect event bus for progress updates

**Verification**:
- [ ] Agents execute real work
- [ ] Progress events received

**Fixes**: AGENT-02

---

### Agent 7C: Pause/Resume + Timeout

**Files to Modify**:
- `crates/forge-agent/src/agent.rs`
- `crates/forge-orchestrator/src/scheduler.rs`

**Steps**:
1. Implement pause/resume in ForgeAgent:
   ```rust
   async fn handle_message(&mut self, msg: AgentMessage) -> Result<()> {
       match msg {
           AgentMessage::Pause => {
               self.state = AgentState::Paused {
                   previous: Box::new(self.state.clone())
               };
           }
           AgentMessage::Resume => {
               if let AgentState::Paused { previous } = &self.state {
                   self.state = *previous.clone();
               }
           }
           // ... other messages
       }
   }
   ```
2. Add timeout enforcement in scheduler:
   ```rust
   async fn monitor_timeouts(&self) {
       loop {
           for (task_id, task) in self.tasks.iter() {
               if let Some(timeout) = task.timeout {
                   if task.started_at.elapsed() > timeout {
                       self.timeout_task(task_id).await;
                   }
               }
           }
           tokio::time::sleep(Duration::from_secs(10)).await;
       }
   }
   ```
3. Start timeout monitor in orchestrator

**Verification**:
- [ ] Pause halts agent work
- [ ] Resume continues from checkpoint
- [ ] Timed out tasks marked failed

**Fixes**: AGENT-03, AGENT-04

---

## Testing Strategy

### Per-Wave Testing
- Each agent runs `cargo build -p forge-tauri` and `cargo test`
- Manual verification of IPC commands using Tauri devtools

### Integration Testing
- Wave 2 completion: Verify events flow to frontend
- Wave 3-4 completion: Test full changelog/roadmap workflow
- Wave 7 completion: End-to-end task execution

### Regression Testing
- Run full test suite after each wave: `cargo test --workspace`
- Verify existing features still work

---

## Rollback Plan

Each wave is independently revertable:
- Wave 1: Remove added registrations, revert stub implementations
- Wave 2: Remove event types and emission code
- Wave 3-4: Remove new commands, revert to in-memory only
- Wave 5: Revert to NotImplemented
- Wave 6: Revert to no-op implementations
- Wave 7: Revert to placeholder agent loop

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| AI service unavailable | Medium | High | Fallback to placeholder responses |
| Breaking existing tests | Low | Medium | Run full test suite after each wave |
| Event system overwhelm | Low | Medium | Rate limit event emission |
| Persistence migration | Low | High | Version persistence format |
| Agent complexity | Medium | High | Comprehensive error handling |

---

## Parallel Execution Strategy

| Wave | Agents | Parallelism | Duration |
|------|--------|-------------|----------|
| Wave 1 | 4 | Full parallel | 1-2 hours |
| Wave 2 | 3 | Full parallel | 2-3 hours |
| Wave 3 | 2 | Full parallel | 3-4 hours |
| Wave 4 | 2 | Full parallel | 3-4 hours |
| Wave 5 | 2 | Full parallel | 2-3 hours |
| Wave 6 | 2 | Full parallel | 2-3 hours |
| Wave 7 | 3 | Sequential | 4-6 hours |

**Total Agents**: 18
**Estimated Duration**: ~20 hours of agent work (compressed via parallelism)

---

## Success Criteria

After all waves complete:
- [ ] All 47 gaps addressed
- [ ] All features at 100% completeness
- [ ] `cargo build --workspace` passes
- [ ] `cargo test --workspace` passes
- [ ] No NotImplemented errors in production code
- [ ] All IPC commands registered and functional

---

## Wave 8: Browser Testing + Web Build (Final)

**Objective**: Test all workflows via browser automation, fix issues, build web version.

### Agent 8A: Browser Workflow Testing

**Using**: Browser automation tools (bdg/playwright)

**Workflows to Test**:
1. Setup Wizard - Complete onboarding flow
2. Terminal - Create, input, resize, Claude invocation
3. Kanban - Task CRUD, drag-and-drop, status changes
4. GitHub - OAuth, issue fetching, import
5. Linear - OAuth, issue fetching
6. Insights - Chat, task creation
7. Roadmap - Generation, feature management
8. Ideation - Generation, convert to task
9. Changelog - Generation, save, export

**Steps**:
1. Launch Forge dev server
2. Navigate through each workflow
3. Capture screenshots of issues
4. Document failures for fixing

### Agent 8B: Fix Browser-Found Issues

**Steps**:
1. Review test failures from 8A
2. Fix each issue identified
3. Re-test to confirm fix

### Agent 8C: Web Build + Final Verification

**Steps**:
1. Run `npm run build` in ui/ directory
2. Run `cargo build --release -p forge-tauri`
3. Verify production build works
4. Final smoke test of key workflows

**Verification**:
- [ ] All browser tests pass
- [ ] Web build completes without errors
- [ ] Production app launches

---

**EXECUTION APPROVED - AUTONOMOUS MODE ENABLED**
