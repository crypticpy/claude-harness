# Implementation Plan: Fix Orchestrator Run Loop Not Starting

Created: 2025-12-22
Status: PENDING APPROVAL

## Summary

Tasks are getting created and submitted to the orchestrator, but the orchestrator's main run loop (`orchestrator.run()`) is never started. This means `schedule_tasks()` is never called, so tasks are never assigned to agents. The fix is to call `start_orchestrator()` during app initialization.

## Root Cause Analysis

The issue was traced through:
1. `task_start` IPC handler submits task to `orchestrator.submit_task()` - this works
2. `submit_task()` adds the task to the scheduler's queue - this works
3. `orchestrator.run()` is the main loop that calls `schedule_tasks()` to assign tasks to idle agents
4. **`start_orchestrator()` function exists in `commands.rs:446` but is NEVER called**
5. Without the run loop, tasks sit in the queue forever

Evidence:
- Logs show "Starting task id=task_3994b0640b83" but nothing after
- Grep for `start_orchestrator` only finds the function definition, no callers
- Grep for `orchestrator.run()` shows it's only in tests and the unused `start_orchestrator()` function

## Scope

### In Scope
- Starting the orchestrator run loop during app initialization
- Ensuring proper shutdown of the orchestrator loop

### Out of Scope
- Changes to the agent execution logic (that's working once tasks are assigned)
- Frontend changes (UI is correctly calling task_start)
- LLM integration or phase execution (separate concern)

## Prerequisites
- None - this is a critical bug fix

## Implementation Phases

### Phase 1: Start Orchestrator Run Loop

**Objective**: Call `start_orchestrator()` during Tauri app setup so the orchestrator's main loop runs and tasks get scheduled to agents.

**Files to Modify**:
- `crates/forge-tauri/src/main.rs` - Add orchestrator startup in the setup closure

**Steps**:
1. In `main.rs` setup closure (around line 2144), after state is created and event bridge is spawned, add a call to start the orchestrator run loop:
   ```rust
   // Start the orchestrator run loop
   let orchestrator_state = Arc::clone(&state);
   tauri::async_runtime::spawn(async move {
       let orchestrator = orchestrator_state.orchestrator();
       if let Err(e) = orchestrator.run().await {
           tracing::error!(error = %e, "Orchestrator run loop error");
       }
   });
   ```

2. The orchestrator run loop will:
   - Listen for events on the bus
   - Call `schedule_tasks()` periodically to assign ready tasks to idle agents
   - Handle task completion events
   - Auto-spawn agents if configured

**Verification**:
- [ ] Build succeeds: `cargo build -p forge-tauri`
- [ ] App starts without errors
- [ ] Creating and starting a task shows orchestrator activity in logs
- [ ] Tasks transition from "pending" to "in_progress" to being executed by agents

### Phase 2: Add Logging for Debugging (Optional Enhancement)

**Objective**: Add trace-level logging to help debug future issues with task scheduling.

**Files to Modify**:
- `crates/forge-orchestrator/src/orchestrator.rs` - Add INFO-level log when run loop starts

**Steps**:
1. Add an info log at the start of `run()`:
   ```rust
   info!("Orchestrator run loop started");
   ```

2. Add info log when a task is scheduled:
   ```rust
   info!(task_id = %task_id, agent_id = %agent_id, "Task scheduled to agent");
   ```

**Verification**:
- [ ] Logs show "Orchestrator run loop started" on app launch
- [ ] Logs show task scheduling when tasks are started

## Testing Strategy

### Manual Testing
1. Build and run the Tauri app: `cargo tauri dev`
2. Add a project
3. Create a task with a description
4. Click "Start Task"
5. Verify in logs:
   - "Starting task id=..." appears
   - "Task submitted to orchestrator" appears
   - "Task scheduled to agent" appears (after Phase 2)
6. Verify task status changes in UI

### Automated Testing
- Existing orchestrator tests in `forge-orchestrator/src/orchestrator.rs` already test the run loop
- No new tests needed for this fix - we're just wiring up existing functionality

## Rollback Plan

If the fix causes issues:
1. Remove the orchestrator spawn block from main.rs setup
2. Rebuild and redeploy

The change is isolated and easily reversible.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Orchestrator panics in run loop | Low | High | Error handling already exists in spawn block; logs error and continues |
| Resource contention with event bridge | Low | Medium | Both use Arc and async; designed for concurrent access |
| Tasks execute but agents aren't ready | Low | Medium | OrchestratorConfig has `auto_spawn=true` and `min_idle_agents=1` already |

## Open Questions

1. Should we add a Tauri command to check orchestrator status from the frontend? (Can be done as follow-up)
2. Should we add graceful shutdown handling for the orchestrator when the app closes? (The existing shutdown() method handles this, but we could add explicit stop_orchestrator() call)

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
