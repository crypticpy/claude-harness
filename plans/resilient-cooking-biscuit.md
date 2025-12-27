# Kanban Flow Stack Audit & Workflow Engine Reliability

## Overview
Full audit of the Kanban flow stack ensuring tasks correctly report statuses to all UI elements, plus reliability fixes to prevent locks, blocks, hangs, and race conditions.

---

## Part 1: UI Synchronization Fixes

### 1.1 Kanban Card Status Sync
**Files:**
- `auto-claude-ui/src/renderer/components/TaskCard.tsx`
- `auto-claude-ui/src/renderer/stores/task-store.ts`

**Issues Found:**
- Task cards rely on `updateTaskFromPlan()` but phase transitions may not trigger re-renders
- Watchdog state (`running`/`assessing`/`stalled`) not always reflected immediately

**Fixes:**
- [ ] Add explicit status change listener in TaskCard for real-time updates
- [ ] Ensure watchdog state changes trigger card badge updates
- [ ] Add visual indicator for parallel worker states (some working, some stalled)

### 1.2 Detail View Tab Synchronization
**Files:**
- `auto-claude-ui/src/renderer/components/execution-flow/ExecutionFlowView.tsx`
- `auto-claude-ui/src/renderer/stores/agent-hierarchy-store.ts`

**Issues Found:**
- ExecutionFlowView has error boundary but may lose state on recovery
- Agent hierarchy store uses namespace keys but tab switches don't always refresh

**Fixes:**
- [ ] Preserve hierarchy state across error boundary recoveries
- [ ] Force hierarchy refresh when switching between task detail tabs
- [ ] Add loading indicators during hierarchy data fetches

### 1.3 Log Display During Parallel Execution
**Files:**
- `auto-claude-ui/src/main/ipc-handlers/agent-events-handlers.ts`
- `auto-claude-ui/src/renderer/stores/task-store.ts` (appendLog)

**Issues Found:**
- Logs from multiple parallel workers interleave without identification
- No visual separation between worker log streams

**Fixes:**
- [ ] Add worker ID prefix to log entries from parallel workers
- [ ] Add collapsible log sections per worker in UI
- [ ] Show which worker is currently active/stalled

---

## Part 2: Agent Tracker Expansion

### 2.1 Show All Agent Phases (Currently Coding Only)
**Files:**
- `auto-claude-ui/src/renderer/components/hierarchy/AgentHierarchyTree.tsx`
- `auto-claude-ui/src/renderer/stores/agent-hierarchy-store.ts`
- `auto-claude-ui/src/main/ipc-handlers/agent-events-handlers.ts`

**Current State:**
- Agent tracker only shows coding agents
- Planning and QA phases don't emit hierarchy events

**User Choice:** All phases together (unified view with phase labels)

**Fixes:**
- [ ] Add phase field to hierarchy events: `planning`, `coding`, `qa_review`, `qa_fixing`
- [ ] Update Python event emission to include phase context
- [ ] Add phase badges/labels to agent tree nodes
- [ ] Group agents by phase in the hierarchy display
- [ ] Show phase transition markers in timeline

### 2.2 Python Side - Emit Events for All Phases
**Files:**
- `auto-claude/agents/planner.py` - Add hierarchy event emission
- `auto-claude/agents/qa.py` - Add hierarchy event emission
- `auto-claude/events/handlers.py` - Update HierarchyFileHandler for phase context

**Fixes:**
- [ ] Wrap planner agent session in hierarchy event scope
- [ ] Wrap QA reviewer/fixer in hierarchy event scope
- [ ] Add `execution_phase` field to all agent events
- [ ] Update hierarchy JSON format to include phase

---

## Part 3: Self-Recovery & Self-Healing Audit ✅ VERIFIED

### 3.1 AI Task Doctor Integration ✅
**Files:**
- `auto-claude/agents/recovery_agent.py`
- `auto-claude/agents/subtask_recovery_agent.py`
- `auto-claude-ui/src/main/ipc-handlers/agent-events-handlers.ts`

**Audit Results:**
- [x] Recovery agent receives full context from stalled session:
  - `subtask` dict with description, files, verification
  - `attempt_history` from RecoveryManager
  - `error_context` from stall trigger
  - Memory context (patterns, gotchas, session_insights)
  - Git context (recent commits, uncommitted changes)
- [x] Model cascade properly configured: `execute_with_cascade()` with `get_recovery_model_cascade()`
  - Opus 4.5 → Sonnet 4 → ZAI GLM-4.7 → MinMax 2.1
- [x] Recovery attempt tracking via `RecoveryManager.record_attempt()` and `get_attempt_count()`
- [x] Tiered recovery strategies in SubtaskRecoveryAgent:
  - AUTO_COMPLETE → REQUEST_JUSTIFICATION → MARK_BLOCKED → ESCALATE
- [x] `max_retries` default 3, prevents infinite loops

**Minor Issue (non-blocking):**
- SubtaskRecoveryAgent `_execute_auto_complete()` uses generic error_context
  - Could enrich with actual verification issue details (enhancement, not bug)

### 3.2 Stall Detection & Recovery Hooks ✅
**Files:**
- `auto-claude-ui/src/main/agent/watchdog.ts`
- `auto-claude/core/activity_monitor.py`

**Audit Results:**
- [x] Python `__ACTIVITY__` markers emitted on every message in `record_activity()`
- [x] `__STALL_DETECTED__` emitted in `check_stall()` when threshold exceeded
- [x] `__API_ERROR__:{json}` emitted with categorized SDK errors
- [x] `__NEEDS_CONTINUE__` pattern detection for stalled agents
- [x] `sdkActivityReceived` flag distinguishes SDK markers from stdout (parallel fix)
- [x] Health check threshold (3 assessments) triggers continue injection
- [x] Hard stall threshold (10 assessments ~5min) declares stalled regardless of SDK
- [x] Per-worker tracking via `taskStates` Map with unique taskId keys

---

## Part 4: SDK Method Verification ✅ VERIFIED

### 4.1 Claude SDK Usage Audit ✅
**Files:**
- `auto-claude/core/client.py`
- `auto-claude/agents/session.py`

**Verified SDK Methods (current as of 2025):**
```python
# client.py - Client creation
ClaudeSDKClient(options=ClaudeAgentOptions(...))

# session.py - Session execution
await client.query(message)                    # ✅ Current
async for msg in client.receive_response():   # ✅ Current
```

**Verified SDK Types:**
- [x] `ClaudeAgentOptions` with: model, system_prompt, allowed_tools, mcp_servers, hooks, max_turns, cwd, settings, env, max_thinking_tokens
- [x] `HookMatcher` for PreToolUse bash security hooks
- [x] Message types: `AssistantMessage`, `UserMessage`
- [x] Content blocks: `TextBlock`, `ToolUseBlock`, `ToolResultBlock`

### 4.2 Activity Monitor Integration ✅
**Files:**
- `auto-claude/core/activity_monitor.py`

**Verified:**
- [x] All SDK response types handled (AssistantMessage content iteration)
- [x] Tool execution tracking: `ToolUseBlock` increments tool_count, sets last_tool_name
- [x] `ToolResultBlock` handled for awaiting_tool_result state
- [x] `__NEEDS_CONTINUE__` detection via:
  - Pattern matching ("I'll continue", "Let me continue", etc.)
  - Consecutive empty responses (2+) after tool use
- [x] Error categorization: CONNECTION_ERROR, PROCESS_ERROR, JSON_DECODE_ERROR, API_ERROR, TIMEOUT_ERROR
- [x] Recoverable vs non-recoverable determination (auth errors = not recoverable)

---

## Part 5: Concurrency & Reliability Fixes (CRITICAL)

### 5.1 TOCTOU Race in Tool Functions (CRITICAL)
**Files:**
- `auto-claude/agents/tools_pkg/tools/subtask.py` (lines 114-146)
- `auto-claude/agents/tools_pkg/tools/qa.py` (lines 92-122)
- `auto-claude/agents/tools_pkg/tools/progress.py` (lines 60-61)
- `auto-claude/agents/tools_pkg/tools/memory.py` (lines 60-78)

**Problem:** Read-modify-write on `implementation_plan.json` without locks

**Fix:**
```python
# Add to each tool function
from core.locks import get_global_lock_manager

async def update_subtask_status(...):
    lock_manager = get_global_lock_manager()
    async with lock_manager.get_plan_lock(spec_dir):
        # All file operations inside lock
        plan = json.load(open(plan_file))
        # modify
        json.dump(plan, open(plan_file, 'w'))
```

### 5.2 Event Bus Race Conditions (HIGH)
**File:** `auto-claude/events/bus.py`

**Problems:**
- `publish()` iterates `_subscribers` while `_unsubscribe()` can modify
- `_agent_statuses` dict written without lock

**Fixes:**
- [ ] Add lock protection to `publish()` iteration
- [ ] Protect `_agent_statuses` and `_task_completions` with lock
- [ ] Add shutdown check in `subscribe()` method

### 5.3 AsyncFileLock Cache Race (HIGH)
**File:** `auto-claude/core/locks.py` (lines 273-277)

**Problem:** Check-then-act race can create duplicate lock instances

**Fix:**
```python
def get_lock(self, file_path: Path) -> AsyncFileLock:
    key = str(file_path.resolve())
    with self._cache_lock:
        if key not in self._locks:
            self._locks[key] = AsyncFileLock(file_path)
        return self._locks[key]  # Always return from cache
```
(Current code is correct - verified the return is inside the lock)

### 5.4 Post-Session Lock Contention (MEDIUM)
**File:** `auto-claude/agents/session.py`

**Problem:** 60s timeout under `recovery_lock` starves parallel workers

**Fix:**
- [ ] Move timeout-protected operations outside recovery_lock scope
- [ ] Only hold lock for actual recovery_manager updates
- [ ] Consider per-subtask locks instead of global recovery_lock

### 5.5 AgentPool Counter Race (MEDIUM)
**File:** `auto-claude/agents/pool.py` (lines 117-120)

**Problem:** `_agent_counter += 1` is not atomic

**Fix:**
- [ ] Move counter increment inside the existing `_lock` scope
- [ ] Or use `itertools.count()` for thread-safe counter

---

## Part 6: Commit/Merge & Auto-Merge Audit ✅ VERIFIED

### 6.1 Auto-Merge Flow and Triggers ✅
**Files:**
- `auto-claude/runners/merge_runner.py` - Emits progress markers
- `auto-claude-ui/src/main/ipc-handlers/task/auto-merge-handlers.ts` - Parses markers, sends IPC
- `auto-claude-ui/src/renderer/hooks/useIpc.ts` - Listeners for merge events
- `auto-claude-ui/src/renderer/stores/autostart-queue-store.ts` - State management

**Verified Event Flow:**
```
merge_runner.py emits:
  __AUTO_MERGE_PROGRESS__:{status, message, conflictCount...}
  __AUTO_MERGE_COMPLETE__:{success, message, report}
  __AUTO_MERGE_FAILED__:{success: false, error}
    ↓
auto-merge-handlers.ts parses stdout, sends IPC:
  IPC_CHANNELS.AUTO_MERGE_PROGRESS → mainWindow.webContents.send()
  IPC_CHANNELS.AUTO_MERGE_COMPLETE → mainWindow.webContents.send()
  IPC_CHANNELS.AUTO_MERGE_FAILED → mainWindow.webContents.send()
    ↓
useIpc.ts listeners call:
  onAutoMergeProgress(progress)
  onAutoMergeComplete(taskId, result)
  onAutoMergeFailed(taskId, result)
    ↓
autostart-queue-store updates MergeState
    ↓
AutoMergeProgress.tsx and WorkspaceStatus.tsx re-render
```

**Merge Status Types:**
- `pending` → `reviewing` → `merging` → `resolving_conflicts` → `completed`/`failed`

### 6.2 AI Review (Senior Engineer) Phase ✅
**Files:**
- `auto-claude-ui/src/main/ipc-handlers/task/ai-review-handlers.ts`
- `auto-claude-ui/src/renderer/hooks/useIpc.ts`
- `auto-claude-ui/src/renderer/stores/autostart-queue-store.ts`

**Verified Event Flow:**
```
ai-review-handlers.ts:
  - Looks for runners/ai_review_runner.py
  - Falls back to performSimplifiedReview() if not found
  - Simplified review checks: plan exists, subtasks completed, QA status

IPC Events:
  AI_REVIEW_PROGRESS → (taskId, status, message)
  AI_REVIEW_COMPLETE → (taskId, approved, issues?)

useIpc.ts:
  - Updates execution phase to 'qa_review' during review
  - Updates agent hierarchy for qa_review phase
  - On approval: phase → 'complete', triggers auto-merge if enabled
```

**AI Review Status Flow:**
- `starting` → `checking` → `analyzing` → `reviewing` → `approved`/`rejected`/`failed`

**IMPLEMENTED:** `auto-claude/runners/ai_review_runner.py` now fully implemented (999 lines) with:
- Four review phases: checking (subtasks), analyzing (QA report), reviewing (git), AI review
- Model cascade integration (opus → sonnet → glm → minimax)
- Progress markers matching IPC handler expectations
- Debug statement detection in diffs (breakpoint, pdb, debugger)
- Proper Windows encoding handling matching merge_runner.py pattern

### 6.3 Merge Conflict Detection & Resolution ✅
**Files:**
- `auto-claude/runners/merge_runner.py` - Full conflict resolution pipeline
- `auto-claude-ui/src/renderer/components/task-detail/task-review/ConflictResolutionDialog.tsx`
- `auto-claude-ui/src/renderer/components/task-detail/task-review/WorkspaceStatus.tsx`

**Verified Features:**
- [x] Git conflicts detected via `mergePreview.gitConflicts.hasConflicts`
- [x] Uncommitted changes handled with automatic stash/restore
- [x] AI-assisted conflict resolution with progress tracking
- [x] ConflictResolutionProgress: `{status, currentFile, filesResolved, totalFiles}`
- [x] ConflictResolutionResult: `{success, resolvedFiles, failedFiles, stats}`
- [x] Stats include: autoMerged, aiMerged, lockFilesExcluded

**Conflict Resolution UI Flow:**
1. WorkspaceStatus shows "Branch Diverged - Needs resolution"
2. User clicks "Resolve Conflicts with AI"
3. ConflictResolutionDialog shows progress
4. On completion: shows resolved/failed files, stats
5. User can proceed with merge or close

### 6.4 UI Visualization for Final Stages ✅
**Files:**
- `auto-claude-ui/src/renderer/components/task-detail/task-review/AutoMergeProgress.tsx`
- `auto-claude-ui/src/renderer/components/task-detail/task-review/ConflictResolutionDialog.tsx`
- `auto-claude-ui/src/renderer/components/task-detail/task-review/WorkspaceStatus.tsx`
- `auto-claude-ui/src/renderer/components/hierarchy/AgentHierarchyTree.tsx`

**Verified UI Components:**
- [x] `AutoMergeProgressCompact` - Inline status indicator on TaskCard
- [x] `AutoMergeProgressFull` - Detailed view with progress bar, failed files
- [x] `WorkspaceStatus` - Branch info, conflict status, merge/discard buttons
- [x] `ConflictResolutionDialog` - AI resolution progress and results
- [x] Phase badges in AgentHierarchyTree: Planning, Coding, QA Review, QA Fix, Complete
- [x] Status transitions update TaskCard badges correctly

**Phase Configuration in UI:**
```typescript
PHASE_CONFIG = {
  planning: { label: 'Planning', color: 'text-purple-500' },
  coding: { label: 'Coding', color: 'text-blue-500' },
  qa_review: { label: 'QA Review', color: 'text-amber-500' },
  qa_fixing: { label: 'QA Fix', color: 'text-orange-500' },
  complete: { label: 'Complete', color: 'text-success' }
}
```

### 6.5 Recovery/Troubleshooter Integration ✅
**Files:**
- `auto-claude-ui/src/renderer/stores/troubleshooter-store.ts`
- `auto-claude-ui/src/main/agent/ai-doctor.ts`
- `auto-claude/agents/recovery_agent.py`

**Verified Features:**
- [x] Troubleshooter for proactive bug detection (Weasel Scan, Ferret Hunt/Trace)
- [x] AI Doctor service for task diagnosis
- [x] Stall detection via watchdog with model cascade recovery
- [x] Recovery agent with Opus → Sonnet → ZAI → MinMax cascade
- [x] IPC listeners in useIpc.ts for all recovery events

**Task Status Flow (End-to-End):**
```
in_progress → (all subtasks complete) → ai_review
ai_review → (approved) → human_review (manual) OR auto_merge (if enabled)
ai_review → (rejected) → human_review with issues
auto_merge → (success) → done
auto_merge → (conflicts) → resolving_conflicts → done/failed
```

---

## Part 7: Status Propagation Verification

### 7.1 End-to-End Status Flow Test
Verify each transition propagates correctly:

```
Python subtask update → implementation_plan.json
    → FileWatcher detects (300ms)
    → IPC TASK_PROGRESS sent
    → task-store.updateTaskFromPlan()
    → TaskCard re-renders
```

**Test Cases:**
- [ ] Single subtask completion
- [ ] Parallel worker completions (verify no lost updates)
- [ ] Phase transitions (planning → coding → qa)
- [ ] Stall detection → recovery → resume
- [ ] Task failure → human_review column

### 7.2 Hierarchy Event Flow Test
```
Python agent event → hierarchy_events.json
    → FileWatcher detects
    → IPC AGENT_HIERARCHY_EVENT sent
    → agent-hierarchy-store.handleEvent()
    → AgentHierarchyTree re-renders
```

**Test Cases:**
- [ ] Agent spawn during each phase
- [ ] Subagent spawn and completion
- [ ] Work package creation and status updates
- [ ] File claim and release events

---

## Implementation Order

### Phase 1: Critical Concurrency Fixes ✅ COMPLETE
1. ✅ Add locks to tool functions (5.1)
2. ✅ Fix event bus races (5.2)
3. ✅ Fix post-session lock contention (5.4)

### Phase 2: Agent Tracker Expansion ✅ COMPLETE
1. ✅ Add phase context to Python events (2.2)
2. ✅ Update hierarchy store for phases (2.1)
3. ✅ Update AgentHierarchyTree UI (2.1)

### Phase 3: UI Sync Improvements ✅ COMPLETE
1. ✅ TaskCard watchdog state propagation (1.1)
2. ✅ ExecutionFlowView loading indicator (1.2)
3. ✅ Parallel worker log display (1.3) - verified already implemented

### Phase 4: Recovery System Audit ✅ COMPLETE
1. ✅ AI Doctor integration verification (3.1) - all working
2. ✅ Stall detection hook verification (3.2) - all working
3. ✅ SDK method verification (4.1, 4.2) - methods current

### Phase 5: Commit/Merge Audit ✅ COMPLETE
1. ✅ Auto-merge flow and triggers (6.1) - all markers verified
2. ✅ AI Review (senior engineer) phase (6.2) - simplified fallback working
3. ✅ Merge conflict detection & resolution (6.3) - AI resolution verified
4. ✅ UI visualization for final stages (6.4) - all components verified
5. ✅ Recovery/troubleshooter integration (6.5) - all systems connected

### Phase 6: End-to-End Testing (NEXT)
1. Status propagation tests (7.1)
2. Hierarchy event tests (7.2)
3. Parallel execution stress tests

---

## Critical Files Summary

| Category | File | Changes |
|----------|------|---------|
| **Concurrency** | `auto-claude/agents/tools_pkg/tools/subtask.py` | Add plan lock |
| **Concurrency** | `auto-claude/agents/tools_pkg/tools/qa.py` | Add plan lock |
| **Concurrency** | `auto-claude/events/bus.py` | Protect subscriber iteration |
| **Concurrency** | `auto-claude/agents/session.py` | Reduce lock scope |
| **Agent Tracker** | `auto-claude/agents/planner.py` | Emit hierarchy events |
| **Agent Tracker** | `auto-claude/agents/qa.py` | Emit hierarchy events |
| **Agent Tracker** | `auto-claude-ui/src/renderer/components/hierarchy/AgentHierarchyTree.tsx` | Phase display |
| **UI Sync** | `auto-claude-ui/src/renderer/components/TaskCard.tsx` | Status listeners |
| **UI Sync** | `auto-claude-ui/src/renderer/stores/agent-hierarchy-store.ts` | Phase handling |
| **Recovery** | `auto-claude/agents/recovery_agent.py` | Context passing |
| **Recovery** | `auto-claude-ui/src/main/agent/watchdog.ts` | Per-worker tracking |
| **Merge** | `auto-claude/runners/merge_runner.py` | Auto-merge pipeline |
| **Merge** | `auto-claude-ui/src/main/ipc-handlers/task/auto-merge-handlers.ts` | IPC handlers |
| **Merge** | `auto-claude-ui/src/main/ipc-handlers/task/ai-review-handlers.ts` | AI review handlers |
| **Merge** | `auto-claude/runners/ai_review_runner.py` | ✅ **NEW** AI review runner |
| **Merge UI** | `auto-claude-ui/src/renderer/components/task-detail/task-review/AutoMergeProgress.tsx` | Merge status |
| **Merge UI** | `auto-claude-ui/src/renderer/components/task-detail/task-review/ConflictResolutionDialog.tsx` | Conflict UI |
| **Merge UI** | `auto-claude-ui/src/renderer/components/task-detail/task-review/WorkspaceStatus.tsx` | Workspace UI |

---

# Part 8: Agent Quality & Verification Hardening (NEW)

## Overview
Deep audit of all agent prompts and verification mechanisms to ensure high-quality, fully-integrated work with no stubs, TODOs, or placeholders slipping through.

**Problem Statement:**
- Found stub implementations and TODOs that passed through the system because "code technically runs"
- Agents can mark subtasks `completed` without actual verification execution
- Detection systems exist but run too late (during QA phase, not at completion time)

---

## 8.1 Root Cause Analysis ✅ VERIFIED

### The Verification Gap

**Current Flow (Broken):**
```
Agent implements subtask (or stub)
    ↓
Agent calls update_subtask_status("completed")  ← BLINDLY ACCEPTS
    ↓
Status marked complete - NO VERIFICATION
    ↓
Post-session sees status="completed" ← TRUSTS THE AGENT
    ↓
QA runs LATER → catches stub → too late, damage done
```

**Critical Files with No Verification Gates:**
| File | Issue |
|------|-------|
| `auto-claude/agents/tools_pkg/tools/subtask.py` | `update_subtask_status` accepts any status without checks |
| `auto-claude/agents/session.py` | Post-session only checks status field changed, not verification passed |
| `auto-claude/prompts/coder.md` | Self-critique is advisory text, not enforced in code |

### What Exists But Isn't Used at Completion Time

| Component | Location | What It Does | When It Runs |
|-----------|----------|--------------|--------------|
| CompletenessChecker | `qa/completeness_checker.py` | Detects 13 issue types (stubs, TODOs, mocks) | QA phase only |
| SubtaskVerifier | `qa/subtask_verifier.py` | Validates skip/deviate justifications | QA phase only |
| Self-Critique Checklist | `prompts/coder.md` | Pattern adherence, error handling | Agent discretion |
| Verification Specs | `implementation_plan.json` | Command/API/browser tests | Never auto-executed |

---

## 8.2 Solution Architecture

### Two-Layer Defense

**Layer 1: Prevention (At Subtask Completion Time)**
- Enforce verification execution BEFORE allowing `status: completed`
- Run completeness check on modified files in real-time
- Block incomplete work at the tool level

**Layer 2: Detection (Existing QA Phase - Hardened)**
- Strengthen QA prompts with explicit stub/TODO hunting
- Add automated completeness check to QA loop
- Make CompletenessChecker mandatory (not optional)

---

## 8.3 Implementation Plan

### Phase 1: Tool-Level Verification Gates (CRITICAL)

#### 1.1 Add Verification Requirement to update_subtask_status

**File:** `auto-claude/agents/tools_pkg/tools/subtask.py`

**Changes:**
- [ ] Add new optional parameter: `verification_result: dict | None`
- [ ] When status="completed", require verification_result OR critique_result
- [ ] Run lightweight completeness check on `files_to_modify` before accepting
- [ ] Track verification execution in plan: `"verification_executed": true`

**New Verification Flow:**
```python
@tool("update_subtask_status", ...)
async def update_subtask_status(args: dict[str, Any]) -> dict[str, Any]:
    status = args["status"]
    verification_result = args.get("verification_result")

    if status == "completed":
        # GATE 1: Require verification evidence
        if not verification_result:
            return {"error": "Cannot mark completed without verification_result"}

        # GATE 2: Run quick completeness check on modified files
        from qa.completeness_checker import quick_check_files
        files = subtask.get("files_to_modify", [])
        issues = quick_check_files(project_dir, files)
        if issues.has_critical:
            return {"error": f"Critical completeness issues found: {issues.summary}"}

    # Proceed with update...
```

#### 1.2 Create Lightweight Completeness Check Function

**File:** `auto-claude/qa/completeness_checker.py`

**New Function:**
```python
def quick_check_files(project_dir: Path, files: list[str]) -> QuickCheckResult:
    """
    Fast completeness check for a small set of files.
    Used at subtask completion time for real-time blocking.

    Only checks CRITICAL issues:
    - stub_function (pass, ..., NotImplementedError)
    - todo_comment
    - fixme_comment
    - placeholder_string
    - mock_usage (in non-test files)
    """
    # Fast regex + AST check, ~100ms for 5 files
```

#### 1.3 Add Verification Execution Tool

**New File:** `auto-claude/agents/tools_pkg/tools/verification.py`

**New Tool:**
```python
@tool("run_subtask_verification", ...)
async def run_subtask_verification(args: dict[str, Any]) -> dict[str, Any]:
    """
    Execute the verification defined in a subtask and return results.

    Types supported:
    - command: Run shell command, check exit code and output
    - api: HTTP request, check status and response
    - browser: Puppeteer verification (requires browser tools)
    - manual: Return guidance for manual verification
    """
```

---

### Phase 2: Agent Prompt Hardening

#### 2.1 Coder Prompt Updates

**File:** `auto-claude/prompts/coder.md`

**Changes:**
- [ ] Make self-critique MANDATORY with tool enforcement (not just text)
- [ ] Add explicit "no stubs" rule with examples
- [ ] Require calling `run_subtask_verification` before `update_subtask_status(completed)`
- [ ] Add anti-pattern examples to avoid

**New Section:**
```markdown
## FORBIDDEN PATTERNS (Will Block Completion)

These patterns will cause your subtask completion to be REJECTED:

### Stub Functions
```python
# FORBIDDEN - Will be caught and blocked
def my_function():
    pass  # ← STUB

def my_function():
    ...  # ← STUB

def my_function():
    raise NotImplementedError  # ← STUB
```

### TODO/FIXME Comments
```python
# FORBIDDEN - Indicates incomplete work
# TODO: implement this later  # ← BLOCKED
# FIXME: this needs work  # ← BLOCKED
```

### Placeholder Values
```python
# FORBIDDEN - Must use real values or environment variables
api_key = "YOUR_API_KEY_HERE"  # ← BLOCKED
api_key = "placeholder"  # ← BLOCKED
api_key = "TODO"  # ← BLOCKED
```

## MANDATORY COMPLETION SEQUENCE

You MUST follow this exact sequence to complete a subtask:

1. Implement the subtask fully (no stubs, no TODOs)
2. Run self-critique checklist (STEP 6.5)
3. Call `run_subtask_verification` tool
4. Only if verification passes: call `update_subtask_status(completed)`

Attempting to mark completed without verification will FAIL.
```

#### 2.2 QA Reviewer Prompt Updates

**File:** `auto-claude/prompts/qa_reviewer.md`

**Changes:**
- [ ] Add mandatory Phase 0.5: Run CompletenessChecker before any other validation
- [ ] Add explicit stub/TODO hunting instructions
- [ ] Require verification execution proof in plan before approving

**New Phase:**
```markdown
## PHASE 0.5: AUTOMATED COMPLETENESS CHECK (MANDATORY)

Before any manual validation, run the completeness checker:

```python
from qa.completeness_checker import CompletenessChecker

checker = CompletenessChecker(project_dir, spec_dir)
report = checker.check_all_modified_files()

if not report.is_production_ready:
    # STOP - Do not proceed with QA
    # Create COMPLETENESS_FIX_REQUEST.md
    # Return status: "rejected"
    print("BLOCKING: Critical completeness issues found")
    print(report.to_markdown())
```

**This phase is NON-NEGOTIABLE.** If the completeness check fails:
1. Do NOT proceed to other phases
2. Create COMPLETENESS_FIX_REQUEST.md with all issues
3. Return "rejected" immediately
4. The Coder Agent must fix these before QA can continue
```

#### 2.3 QA Fixer Prompt Updates

**File:** `auto-claude/prompts/qa_fixer.md`

**Changes:**
- [ ] Add explicit handling for completeness issues
- [ ] Require re-running completeness check after fixes
- [ ] Add "false completion claim" tracking for repeated offenses

---

### Phase 3: QA Loop Integration

#### 3.1 Integrate CompletenessChecker into QA Loop

**File:** `auto-claude/qa/loop.py`

**Changes:**
- [ ] Add completeness check as mandatory first step
- [ ] Block QA progression if completeness fails
- [ ] Track completeness failures in iteration history

**Code Changes:**
```python
async def run_qa_loop():
    # STEP 0 (NEW): Run completeness check BEFORE QA agent
    from qa.completeness_integration import run_completeness_check

    completeness_result = await run_completeness_check(
        project_dir=project_dir,
        spec_dir=spec_dir,
        check_modified_only=True,
        fail_on_critical=True
    )

    if not completeness_result.passed:
        # Don't even run QA agent - return to coder
        await create_completeness_fix_request(completeness_result)
        return QAResult(
            status="rejected",
            reason="completeness_check_failed",
            issues=completeness_result.critical_issues
        )

    # Continue with normal QA loop...
```

#### 3.2 Add Completeness Check to SubtaskVerifier

**File:** `auto-claude/qa/subtask_verifier.py`

**Changes:**
- [ ] Add `verification_executed` check for completed subtasks
- [ ] Flag subtasks marked complete without verification proof
- [ ] Add new IssueType: `UNVERIFIED_COMPLETION`

---

### Phase 4: Agent Prompt Audit (All 51 Prompts)

#### 4.1 Core Pipeline Prompts (Priority)

| Prompt | Current State | Changes Needed |
|--------|--------------|----------------|
| `planner.md` | Has Phase 0 investigation | Add verification requirements to subtask definitions |
| `coder.md` | Advisory self-critique | Make verification mandatory via tool enforcement |
| `coder_recovery.md` | Good retry logic | Add completeness check to recovery attempts |
| `qa_reviewer.md` | Context7 validation | Add mandatory completeness phase |
| `qa_fixer.md` | FALSE COMPLETION tracking | Add completeness verification after fixes |
| `completeness_reviewer.md` | Already comprehensive | Integrate with QA loop (currently separate) |

#### 4.2 Spec Creation Prompts

| Prompt | Changes Needed |
|--------|----------------|
| `spec_writer.md` | Add verification requirements to acceptance criteria template |
| `spec_researcher.md` | No changes needed |
| `spec_critic.md` | Add check for missing verification criteria |

#### 4.3 Recovery/Integration Prompts

| Prompt | Changes Needed |
|--------|----------------|
| `recovery_agent.md` | Add completeness check before declaring recovered |
| `merge_reviewer.md` | Add final completeness gate before merge approval |
| `integration_reviewer.md` | Add pattern for detecting incomplete integrations |

---

## 8.4 Verification Tools Inventory

### New Tools to Create

| Tool Name | Purpose | Integration Point |
|-----------|---------|-------------------|
| `run_subtask_verification` | Execute verification specs | Coder agent before completion |
| `quick_completeness_check` | Fast stub/TODO detection | Tool-level gate |
| `validate_completion_claim` | Verify agent claims are accurate | Post-session processing |

### Existing Tools to Modify

| Tool Name | File | Changes |
|-----------|------|---------|
| `update_subtask_status` | `tools/subtask.py` | Add verification requirement |
| `CompletenessChecker` | `qa/completeness_checker.py` | Add `quick_check_files()` |
| `SubtaskVerifier` | `qa/subtask_verifier.py` | Add `UNVERIFIED_COMPLETION` issue |

---

## 8.5 Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Verification scope | **Configurable per subtask** | Planner marks `verification_required: true/false` based on subtask type |
| Check aggressiveness | **Fast critical only** | ~100ms check for stubs, TODOs, FIXMEs at completion time; full check in QA |
| Rejection behavior | **Block with clear message** | Return error with specific issues; agent must fix and retry |

---

## 8.6 Implementation Order

### Sprint 1: Tool-Level Gates (Highest Impact) ✅ COMPLETE
1. [x] Add `quick_check_files()` to CompletenessChecker
2. [x] Modify `update_subtask_status` to require verification (when `verification_required: true`)
3. [x] Create `run_subtask_verification` tool
4. [x] Test with sample subtask completions

### Sprint 2: Prompt Hardening ✅ COMPLETE
1. [x] Update `coder.md` with mandatory verification sequence
2. [x] Update `qa_reviewer.md` with completeness phase
3. [x] Update `qa_fixer.md` with completeness verification
4. [x] Add anti-pattern examples to all core prompts

### Sprint 3: QA Loop Integration ✅ COMPLETE
1. [x] Integrate completeness check as QA loop step 0
2. [x] Update SubtaskVerifier with UNVERIFIED_COMPLETION
3. [x] Add verification tracking to implementation_plan.json
4. [x] Test end-to-end with intentional stub

### Sprint 4: Full Prompt Audit ✅ COMPLETE
1. [x] Audit all prompts for quality gaps
2. [x] Add verification requirements to key prompts (ADDITIVE changes only):
   - `planner.md` - Added `verification_required` field documentation
   - `recovery_agent.md` - Added Pre-Completion Verification section
   - `merge_reviewer.md` - Added Phase 2.5 Automated Completeness Check
   - `spec_writer.md` - Added verification command examples
   - `spec_critic.md` - Added verification criteria check
3. [x] Context7 already integrated in core prompts (qa_reviewer, qa_fixer)
4. [x] Audit findings: All core prompts now have quality gates

---

## 8.7 Success Criteria

### Measurable Outcomes
- [ ] 0 stubs make it past subtask completion
- [ ] 0 TODOs make it past subtask completion
- [ ] All completed subtasks have `verification_executed: true`
- [ ] Completeness check runs before every QA validation
- [ ] QA rejection rate for completeness issues drops to 0 (caught earlier)

### Test Cases
1. **Stub Prevention Test**: Agent creates stub function → Tool rejects completion
2. **TODO Prevention Test**: Agent leaves TODO comment → Tool rejects completion
3. **Verification Enforcement Test**: Agent skips verification → Tool rejects completion
4. **QA Integration Test**: Completeness issues → QA returns "rejected" immediately
5. **Recovery Test**: Recovery agent fixes stub → Completeness check passes → Continue

---

## 8.8 File Changes Summary

| Category | File | Changes |
|----------|------|---------|
| **Tool Gate** | `auto-claude/agents/tools_pkg/tools/subtask.py` | Add verification requirement |
| **Tool Gate** | `auto-claude/agents/tools_pkg/tools/verification.py` | NEW: verification execution tool |
| **Completeness** | `auto-claude/qa/completeness_checker.py` | Add `quick_check_files()` |
| **QA Loop** | `auto-claude/qa/loop.py` | Add completeness step 0 |
| **Verifier** | `auto-claude/qa/subtask_verifier.py` | Add UNVERIFIED_COMPLETION |
| **Prompt** | `auto-claude/prompts/coder.md` | Mandatory verification sequence |
| **Prompt** | `auto-claude/prompts/qa_reviewer.md` | Add completeness phase |
| **Prompt** | `auto-claude/prompts/qa_fixer.md` | Add completeness verification |
| **Prompt** | `auto-claude/prompts/recovery_agent.md` | Add completeness check |
| **Prompt** | `auto-claude/prompts/merge_reviewer.md` | Add final completeness gate |

---

# Part 9: Self-Healing Recovery Gap Fix (CRITICAL BUG)

## Problem Statement

User's task `004-split-taskcreationwizard` is stuck and asking for manual intervention when self-healing recovery should have auto-fired.

## Root Cause Analysis ✅ IDENTIFIED

### The Gap in Self-Healing Flow

**Current Flow (BROKEN):**
```
Task Stalls (5-min timeout)
    ↓
Watchdog detects stall
    ↓
AI Doctor attempts diagnosis (IF autoRecoveryEnabled)
    ↓
AI Doctor diagnoses SUBTASK_INCOMPLETE
    ↓
AI Doctor calls triggerSubtaskRecoveryCallback()
    ↓
AgentManager emits 'trigger-subtask-recovery' event
    ↓
??? NOTHING LISTENS TO THIS EVENT ???
    ↓
User sees "stuck" warning, must manually click "Recover"
```

### Critical Gaps Found

| Gap | Location | Issue |
|-----|----------|-------|
| **Auto-Recovery OFF by default** | `ai-doctor.ts:98` | `autoRecoveryEnabled = false` - must be manually enabled |
| **No event listener for auto-spawn** | `agent-manager.ts` | Emits `trigger-subtask-recovery` but nothing auto-spawns recovery_runner.py |
| **Recovery agent requires user click** | `recovery-handlers.ts:369` | `TASK_SPAWN_RECOVERY_AGENT` only fires on IPC from UI button click |

### Why It's Not Auto-Firing

1. **AI Doctor is disabled by default** - User must enable via Settings
2. **Even when enabled**, AI Doctor only emits an event, doesn't spawn recovery
3. **No automatic handler** connects the event to spawning `recovery_runner.py`
4. **Recovery agent spawn is UI-driven only** - requires user to click button

## Solution Architecture

### Fix 1: Enable Auto-Recovery by Default (Quick Win)

**File:** `auto-claude-ui/src/main/agent/ai-doctor.ts`

```typescript
// Line 98: Change default
private autoRecoveryEnabled: boolean = true;  // Was: false
```

### Fix 2: Add Event Listener to Auto-Spawn Recovery (Core Fix)

**File:** `auto-claude-ui/src/main/agent/agent-manager.ts`

Add handler that listens for `trigger-subtask-recovery` and auto-spawns recovery:

```typescript
// In constructor or init method:
this.on('trigger-subtask-recovery', async (taskId: string, subtaskId: string) => {
  console.log(`[AgentManager] Auto-spawning recovery for: ${taskId}/${subtaskId}`);

  // Auto-spawn recovery_runner.py with default options
  await this.spawnRecoveryAgent(taskId, {
    action: 'retry',
    subtaskId: subtaskId,
    autoTriggered: true  // Flag to track auto vs manual
  });
});
```

### Fix 3: Wire Up Recovery Agent Spawn Method

**File:** `auto-claude-ui/src/main/agent/agent-manager.ts`

Add method to spawn recovery without IPC:

```typescript
async spawnRecoveryAgent(taskId: string, options: SpawnRecoveryAgentOptions): Promise<void> {
  // Reuse logic from recovery-handlers.ts but callable internally
  const recoveryHandler = new RecoveryHandler(this.projectDir, this.specDir);
  await recoveryHandler.spawnRecoveryAgent(taskId, options);
}
```

### Fix 4: Add Recovery Cooldown to Prevent Infinite Loops

**File:** `auto-claude-ui/src/main/agent/ai-doctor.ts`

Already has 2-min cooldown, but ensure it's respected for auto-spawned recovery:

```typescript
// Track auto-recovery attempts per task
private autoRecoveryAttempts: Map<string, number> = new Map();
private MAX_AUTO_RECOVERY_ATTEMPTS = 3;

async attemptDiagnosis(payload: StallDetectedPayload): Promise<boolean> {
  const attempts = this.autoRecoveryAttempts.get(payload.taskId) || 0;
  if (attempts >= this.MAX_AUTO_RECOVERY_ATTEMPTS) {
    console.log(`[AI Doctor] Max auto-recovery attempts reached for ${payload.taskId}`);
    return false; // Fall back to user intervention
  }
  // ... rest of diagnosis

  if (triggeredRecovery) {
    this.autoRecoveryAttempts.set(payload.taskId, attempts + 1);
  }
}
```

## Implementation Plan

### Sprint 1: Quick Fixes (Immediate)
1. [ ] Change `autoRecoveryEnabled` default to `true`
2. [ ] Add `trigger-subtask-recovery` event listener in AgentManager
3. [ ] Wire recovery spawn method for internal use

### Sprint 2: Robustness
1. [ ] Add recovery attempt tracking with max limit (3)
2. [ ] Add cooldown between auto-recovery attempts (2 min)
3. [ ] Add IPC notification when auto-recovery is triggered
4. [ ] Update UI to show "Auto-recovering..." status

### Sprint 3: Testing
1. [ ] Test: Task stalls → AI Doctor diagnoses → Recovery auto-spawns
2. [ ] Test: Recovery fails 3 times → Falls back to user intervention
3. [ ] Test: Auto-build queue respects recovery cooldowns

## Files to Modify

| File | Changes |
|------|---------|
| `auto-claude-ui/src/main/agent/ai-doctor.ts` | Default `autoRecoveryEnabled = true`, add attempt tracking |
| `auto-claude-ui/src/main/agent/agent-manager.ts` | Add `trigger-subtask-recovery` listener, add `spawnRecoveryAgent()` method |
| `auto-claude-ui/src/main/ipc-handlers/task/recovery-handlers.ts` | Export spawn logic for internal use |

## Success Criteria

- [ ] Task stalls → Auto-recovery fires within 30 seconds (no user action needed)
- [ ] Auto-recovery respects 3-attempt limit before escalating to user
- [ ] UI shows "Auto-recovering..." when recovery is auto-triggered
- [ ] Auto-build queue continues to next task if recovery succeeds
