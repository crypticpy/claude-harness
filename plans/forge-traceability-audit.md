# Implementation Plan: Forge End-to-End Traceability Audit

Created: 2025-12-20
Status: APPROVED - AUTONOMOUS EXECUTION
Approved: 2025-12-20 by User (full autonomy granted)
Note: Execute all waves continuously, test and commit as you go, no stopping between phases.

## Summary

This plan creates a comprehensive traceability audit of the Forge application by assigning specialized sub-agents to verify that every UI workflow has complete, functional Rust backend implementation. Each agent traces their assigned feature end-to-end, identifying gaps, stubs, and broken connections.

## Scope

### In Scope
- All 20+ UI features/workflows in the Forge application
- End-to-end tracing from frontend IPC calls to backend handlers
- Verification that handlers have real implementation (not stubs)
- Dependency chain validation between interconnected features
- Gap identification and documentation

### Out of Scope
- Implementing missing functionality (separate work packages)
- Frontend-only issues (CSS, layout, UX)
- Performance optimization
- Security audit (separate concern)

## Prerequisites
- Access to forge-project codebase
- Understanding of Tauri IPC patterns
- Familiarity with React + Zustand state management

---

## Audit Structure

Each sub-agent produces a **Traceability Report** with:
1. **Workflow Steps** - Every user action in the feature
2. **IPC Mapping** - Frontend call → Backend handler
3. **Implementation Status** - Complete / Partial / Stub / Missing
4. **Dependencies** - Other features this relies on
5. **Gaps Identified** - Specific issues found
6. **Severity Rating** - Critical / Major / Minor

---

## Wave 1: Core Infrastructure (Parallel)

### Agent 1: Setup Wizard Traceability
**Objective**: Verify the onboarding/setup wizard has complete backend support

**UI Components to Trace**:
- `/ui/src/components/onboarding/` - All onboarding components
- `/ui/src/components/settings/` - Initial settings dialogs

**IPC Commands to Verify**:
- `claude_get_profiles`, `claude_save_profile`, `claude_set_active_profile`
- `env_check_claude_auth`, `env_invoke_claude_setup`
- `github_auth_start`, `github_auth_status`
- `linear_auth_start`, `linear_auth_status`
- `project_add`, `project_initialize`
- `settings_get`, `settings_update`
- `infra_get_status`, `infra_start_falkordb`, `infra_validate_falkordb`

**Backend Files to Audit**:
- `crates/forge-tauri/src/ipc/claude/setup_handlers.rs`
- `crates/forge-tauri/src/ipc/claude/profile_handlers.rs`
- `crates/forge-tauri/src/integrations/github/oauth.rs`
- `crates/forge-tauri/src/integrations/linear/oauth.rs`
- `crates/forge-tauri/src/ipc/settings.rs`
- `crates/forge-tauri/src/ipc/infrastructure.rs`

**Verification Checklist**:
- [ ] Each setup step has corresponding backend handler
- [ ] OAuth flows complete (not just start)
- [ ] Profile persistence works
- [ ] Infrastructure startup completes
- [ ] Error handling for each step

---

### Agent 2: Terminal System Traceability
**Objective**: Verify terminal/PTY system is fully functional

**UI Components to Trace**:
- `/ui/src/components/Terminal.tsx`
- `/ui/src/components/TerminalGrid.tsx`
- `/ui/src/components/terminal/` - All terminal subcomponents

**IPC Commands to Verify**:
- `terminal_create`, `terminal_destroy`
- `terminal_input`, `terminal_input_bytes`
- `terminal_resize`, `terminal_clear`
- `terminal_list`, `terminal_get`, `terminal_count`
- `terminal_subscribe`, `terminal_unsubscribe`
- `terminal_generate_name`, `terminal_is_alive`
- `terminal_save_buffer`, `terminal_restore_session`
- `terminal_list_sessions`, `terminal_clear_sessions`
- `terminal_get_session_dates`, `terminal_get_sessions_for_date`
- `terminal_restore_sessions_from_date`
- `terminal_invoke_claude`, `terminal_resume_claude`

**Backend Files to Audit**:
- `crates/forge-tauri/src/terminal/mod.rs`
- `crates/forge-tauri/src/terminal/handle.rs`
- `crates/forge-tauri/src/terminal/actor.rs`
- `crates/forge-tauri/src/terminal/session_store.rs`
- `crates/forge-tauri/src/terminal/claude_session.rs`
- `crates/forge-tauri/src/ipc/terminal.rs`

**Verification Checklist**:
- [ ] PTY creation and I/O works
- [ ] Event streaming (output) functional
- [ ] Session persistence saves/restores correctly
- [ ] Claude CLI invocation works
- [ ] Multi-terminal management
- [ ] Resize/clear operations

---

### Agent 3: Claude Profile Management Traceability
**Objective**: Verify Claude profile/account management is complete

**UI Components to Trace**:
- `/ui/src/stores/claude-profile-store.ts`
- Profile switching UI components
- Usage monitoring components
- Rate limit modals

**IPC Commands to Verify**:
- `claude_get_profiles`, `claude_save_profile`
- `claude_delete_profile`, `claude_rename_profile`
- `claude_set_active_profile`, `claude_set_profile_token`
- `claude_get_auto_switch_settings`, `claude_update_auto_switch_settings`
- `claude_get_best_profile`, `claude_switch_profile`
- `claude_initialize_profile`, `claude_fetch_usage`
- `claude_request_usage_update`, `claude_retry_with_profile`

**Backend Files to Audit**:
- `crates/forge-tauri/src/ipc/claude/manager.rs`
- `crates/forge-tauri/src/ipc/claude/profile_handlers.rs`
- `crates/forge-tauri/src/ipc/claude/usage_handlers.rs`
- `crates/forge-tauri/src/security/keychain.rs`

**Verification Checklist**:
- [ ] Profile CRUD operations work
- [ ] Token storage (keychain) functional
- [ ] Usage tracking updates correctly
- [ ] Auto-switch logic triggers appropriately
- [ ] Rate limit detection and handling

---

## Wave 2: Task Management & Agents (Sequential - Dependencies)

### Agent 4: Agent Workflow Traceability
**Objective**: Verify the agent/orchestrator system is fully implemented

**Dependency**: This powers the Kanban board (Agent 5 depends on this)

**Crates to Audit**:
- `crates/forge-agent/` - Complete audit
- `crates/forge-orchestrator/` - Complete audit

**Key Components to Verify**:
- `ForgeAgent` state machine (all transitions)
- `AgentHandle` communication
- `PhaseExecutor` - Planning, Coding, Reviewing phases
- `ForgeOrchestrator` task assignment
- `AgentPool` lifecycle management
- `TaskScheduler` dependency resolution
- Event bus integration

**Files to Audit**:
- `crates/forge-agent/src/agent.rs`
- `crates/forge-agent/src/runner.rs`
- `crates/forge-agent/src/phases.rs`
- `crates/forge-agent/src/state.rs`
- `crates/forge-orchestrator/src/orchestrator.rs`
- `crates/forge-orchestrator/src/pool.rs`
- `crates/forge-orchestrator/src/scheduler.rs`

**Verification Checklist**:
- [ ] Agent spawning works
- [ ] Task assignment functions
- [ ] All state transitions implemented
- [ ] Planning phases (all 8) execute
- [ ] Coding subtask execution
- [ ] Review phase completion
- [ ] Event publishing for progress
- [ ] Error handling and recovery

---

### Agent 5: Kanban Board Traceability
**Objective**: Verify Kanban task workflow is fully connected

**Dependency**: Requires Agent Workflow (Agent 4) to be functional

**UI Components to Trace**:
- `/ui/src/components/KanbanBoard.tsx`
- `/ui/src/stores/task-store.ts`
- `/ui/src/components/task-detail/` - Task detail panel

**IPC Commands to Verify**:
- `task_create`, `task_list`, `task_get`
- `task_start`, `task_stop`, `task_pause`
- `task_update_status`, `task_update`
- `task_delete`, `task_archive`, `task_unarchive`
- `task_stats`, `task_is_running`
- `task_submit_review`, `task_recover`

**Backend Files to Audit**:
- `crates/forge-tauri/src/ipc/task.rs`
- `crates/forge-tauri/src/ipc/types.rs` (task types)
- Integration with `forge-orchestrator`

**Verification Checklist**:
- [ ] Task CRUD operations work
- [ ] Kanban state transitions (Backlog→InProgress→Review→Done)
- [ ] task_start() submits to orchestrator
- [ ] Progress events update UI
- [ ] Worktree creation on task start
- [ ] Human review workflow
- [ ] Task execution logs capture

---

### Agent 6: Worktree Management Traceability
**Objective**: Verify Git worktree operations work end-to-end

**UI Components to Trace**:
- Worktrees view
- Task detail worktree status
- Merge/discard controls

**IPC Commands to Verify**:
- `worktree_status`, `worktree_list`
- `worktree_diff`, `worktree_diff_staged`
- `worktree_stage`, `worktree_unstage`
- `worktree_commit`, `worktree_push`, `worktree_pull`
- `worktree_branch_list`, `worktree_branch_create`
- `worktree_branch_checkout`, `worktree_branch_delete`
- `worktree_stash`, `worktree_stash_pop`, `worktree_stash_list`
- `worktree_merge`, `worktree_merge_preview`
- `worktree_discard`

**Backend Files to Audit**:
- `crates/forge-tauri/src/ipc/worktree.rs`
- `crates/forge-worktree/src/` - Underlying implementation

**Verification Checklist**:
- [ ] Status and diff operations work
- [ ] Stage/unstage functional
- [ ] Commit/push/pull work
- [ ] Branch operations complete
- [ ] Stash operations work
- [ ] Merge preview accurate
- [ ] Merge execution works
- [ ] Discard/cleanup operations

---

## Wave 3: AI Features (Parallel)

### Agent 7: Insights Traceability
**Objective**: Verify AI-powered insights feature is complete

**UI Components to Trace**:
- `/ui/src/components/insights/` (if exists) or insights views
- `/ui/src/stores/insights-store.ts`

**IPC Commands to Verify**:
- `insights_list`, `insights_list_active`
- `insights_dismiss`, `insights_generate`
- `insights_get_session`, `insights_list_sessions`
- `insights_new_session`, `insights_switch_session`
- `insights_delete_session`, `insights_rename_session`
- `insights_update_model_config`, `insights_clear_session`
- `insights_send_message`, `insights_create_task`

**Backend Files to Audit**:
- `crates/forge-tauri/src/ipc/insights.rs`
- `crates/forge-tauri/src/ai/service.rs` (insights generation)

**Verification Checklist**:
- [ ] Session management works
- [ ] Insight generation functional (with AI configured)
- [ ] Chat functionality (currently returns NotImplemented - KNOWN GAP)
- [ ] Task creation from insights
- [ ] Multi-session support

**Known Issues to Document**:
- `insights_send_message()` returns NotImplemented error

---

### Agent 8: Roadmap Traceability
**Objective**: Verify AI-powered roadmap generation is complete

**UI Components to Trace**:
- `/ui/src/components/roadmap/`
- `/ui/src/stores/roadmap-store.ts`

**IPC Commands to Verify**:
- `roadmap_create`, `roadmap_get`
- `roadmap_list`, `roadmap_delete`
- `roadmap_generate`

**Backend Files to Audit**:
- `crates/forge-tauri/src/ipc/roadmap.rs`
- `crates/forge-tauri/src/ai/service.rs` (roadmap generation)

**Verification Checklist**:
- [ ] Roadmap CRUD operations work
- [ ] AI generation functional (with AI configured)
- [ ] Fallback to placeholder works
- [ ] Phase/feature structure correct
- [ ] Convert features to tasks

---

### Agent 9: Ideation Traceability
**Objective**: Verify AI-powered ideation feature is complete

**UI Components to Trace**:
- `/ui/src/components/ideation/`
- `/ui/src/stores/ideation-store.ts`

**IPC Commands to Verify**:
- `ideation_get`, `ideation_generate`
- `ideation_update_status`, `ideation_convert_to_task`
- `ideation_delete_idea`, `ideation_dismiss_all`
- `ideation_stop`

**Backend Files to Audit**:
- `crates/forge-tauri/src/ipc/ideation.rs`
- `crates/forge-tauri/src/ai/service.rs` (idea generation)

**Verification Checklist**:
- [ ] Idea generation functional (with AI configured)
- [ ] Fallback to placeholder works
- [ ] Status updates work
- [ ] Convert to task works
- [ ] Delete/dismiss operations

**Known Issues to Document**:
- `ideation_stop()` is a no-op (TODO comment)

---

### Agent 10: Changelog Traceability
**Objective**: Verify changelog generation is complete

**UI Components to Trace**:
- `/ui/src/components/changelog/`
- `/ui/src/stores/changelog-store.ts`

**IPC Commands to Verify**:
- `changelog_get`, `changelog_add_entry`
- `changelog_generate`, `changelog_export`

**Backend Files to Audit**:
- `crates/forge-tauri/src/ipc/changelog.rs`
- `crates/forge-tauri/src/ai/service.rs` (changelog generation)

**Verification Checklist**:
- [ ] Changelog CRUD operations
- [ ] AI generation functional
- [ ] Export to markdown
- [ ] GitHub release integration

---

## Wave 4: Integrations (Parallel)

### Agent 11: GitHub Integration Traceability
**Objective**: Verify GitHub integration is fully functional

**UI Components to Trace**:
- `/ui/src/components/github-issues/`
- `/ui/src/stores/github-store.ts`

**IPC Commands to Verify**:
- OAuth: `github_auth_status`, `github_auth_start`, `github_disconnect`
- CLI: `github_check_cli`, `github_check_auth`, `github_start_auth`
- CLI: `github_get_token`, `github_get_user`, `github_list_user_repos`
- CLI: `github_detect_repo`, `github_get_branches`
- Project: `github_check_connection`, `github_get_repositories`
- Project: `github_get_issues`, `github_get_issue`, `github_get_issue_comments`
- Project: `github_import_issues`, `github_investigate_issue`
- Project: `github_create_release`

**Backend Files to Audit**:
- `crates/forge-tauri/src/integrations/github/oauth.rs`
- `crates/forge-tauri/src/integrations/github/cli.rs`
- `crates/forge-tauri/src/integrations/github/api.rs`
- `crates/forge-tauri/src/integrations/github/project.rs`

**Verification Checklist**:
- [ ] OAuth flow complete
- [ ] CLI detection and auth
- [ ] Repository listing
- [ ] Issue fetching (KNOWN GAP: returns empty)
- [ ] Issue import to tasks
- [ ] Release creation

**Known Issues to Document**:
- `github_get_issues()` returns empty list with "not fully implemented" note

---

### Agent 12: Linear Integration Traceability
**Objective**: Verify Linear integration is functional

**UI Components to Trace**:
- `/ui/src/components/linear-import/`

**IPC Commands to Verify**:
- `linear_auth_status`, `linear_auth_start`, `linear_disconnect`
- `linear_get_teams`, `linear_get_projects`
- `linear_get_issues`, `linear_check_connection`
- `linear_import_issues`

**Backend Files to Audit**:
- `crates/forge-tauri/src/integrations/linear/oauth.rs`
- `crates/forge-tauri/src/integrations/linear/handlers.rs`
- `crates/forge-tauri/src/integrations/linear/graphql.rs`

**Verification Checklist**:
- [ ] OAuth flow complete
- [ ] Team/project fetching
- [ ] Issue fetching
- [ ] Issue import

**Known Issues to Document**:
- Linear API calls may be incomplete (needs verification)

---

### Agent 13: Context/Memory Traceability
**Objective**: Verify context/memory features work

**UI Components to Trace**:
- `/ui/src/components/context/`

**IPC Commands to Verify**:
- `context_get_episodes`, `context_add_episode`
- `context_search`, `context_get_stats`

**Backend Files to Audit**:
- `crates/forge-tauri/src/ipc/context.rs`
- `crates/forge-memory/src/` - Memory implementation

**Verification Checklist**:
- [ ] Episode storage/retrieval
- [ ] Search functionality
- [ ] Stats calculation
- [ ] Graphiti integration (if applicable)

---

## Wave 5: Final Validation (Sequential)

### Agent 14: Cross-Feature Integration Audit
**Objective**: Verify features work together correctly

**Integration Points to Verify**:
- Task creation from Insights/Ideation/Roadmap
- Worktree auto-creation on task start
- Agent execution updates Kanban
- Terminal Claude invocation with profiles
- GitHub release from changelog
- Rate limit handling across features

**Verification Checklist**:
- [ ] All cross-feature flows work
- [ ] Events propagate correctly
- [ ] Error states handled gracefully
- [ ] Data consistency maintained

---

## Execution Strategy

### Sub-Agent Assignment

| Wave | Agents | Execution | Model |
|------|--------|-----------|-------|
| 1 | Agents 1-3 | Parallel | Opus |
| 2 | Agent 4 first, then 5-6 | Sequential/Parallel | Opus |
| 3 | Agents 7-10 | Parallel | Opus |
| 4 | Agents 11-13 | Parallel | Opus |
| 5 | Agent 14 | Sequential | Opus |

### Agent Output Format

Each agent produces a report:

```markdown
# Traceability Report: [Feature Name]

## Summary
[1-2 sentence summary of findings]

## Workflow Steps
| Step | User Action | Expected Result |
|------|-------------|-----------------|
| 1    | ...         | ...             |

## IPC Mapping
| Frontend Call | Backend Handler | Status | Notes |
|---------------|-----------------|--------|-------|
| invoke('x')   | handler_x()     | ✅/⚠️/❌ | ...   |

## Implementation Audit
| Function | File:Line | Status | Issue |
|----------|-----------|--------|-------|
| ...      | ...       | ✅/⚠️/❌ | ...   |

## Dependencies
- [Feature X] - Required for Y
- [Feature Z] - Required for W

## Gaps Identified
| ID | Severity | Description | Recommendation |
|----|----------|-------------|----------------|
| G1 | Critical | ...         | ...            |

## Overall Status
- **Completeness**: X%
- **Blocking Issues**: N
- **Recommended Priority**: High/Medium/Low
```

---

## Testing Strategy

### Per-Agent Testing
- Each agent runs relevant IPC commands in isolation
- Verifies return types match expected
- Checks for panic/crash conditions
- Documents error responses

### Integration Testing (Wave 5)
- Cross-feature workflow testing
- Event propagation verification
- State consistency checks

---

## Rollback Plan

This is an audit, not implementation. No code changes are made.
Reports can be regenerated at any time.

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| False positives (incomplete but works) | Medium | Low | Manual verification of flagged items |
| Missing frontend components | Low | Medium | Cross-reference with store files |
| Agent overwhelm | Medium | Medium | Focused scope per agent |
| Dependency chain breaks | Low | High | Wave 2 sequential execution |

---

## Deliverables

1. **14 Traceability Reports** - One per feature area
2. **Gap Summary Document** - Consolidated list of all gaps
3. **Implementation Priority Matrix** - What to fix first
4. **Dependency Map** - Visual of feature interconnections

---

**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
