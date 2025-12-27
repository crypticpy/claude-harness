# Implementation Plan: Fix TaskCard Phase Indicator During Planning

Created: 2025-12-26
Status: PENDING APPROVAL

## Summary
Fix the TaskCard execution phase badge incorrectly showing "Coding" when the task is actually in the "Planning" phase. The bug occurs because tool usage patterns (read file, write file, bash commands) trigger a phase transition to "coding", but the Planner agent also uses these tools during planning.

## Scope
### In Scope
- Fix `parseExecutionPhase()` to not incorrectly transition to coding based on tool usage alone
- Ensure hierarchy events with `executionPhase` are respected as the source of truth
- Maintain backward compatibility with existing phase detection patterns

### Out of Scope
- Changes to Python backend phase emission
- Changes to the detail view (Logs tab) which correctly shows Planning/Coding/Validation
- Other TaskCard display issues

## Prerequisites
- None

## Root Cause Analysis

The issue is in `/Users/aiml/Projects/forge/Auto-Claude/auto-claude-ui/src/main/agent/agent-events.ts` lines 113-118:

```typescript
// Tool execution patterns - strong indicator of coding phase
if ((currentPhase === 'planning' || currentPhase === 'idle') &&
    (lowerLog.includes('[tool:') || lowerLog.includes('executing tool') ||
     lowerLog.includes('read file') || lowerLog.includes('write file') ||
     lowerLog.includes('edit file') || lowerLog.includes('bash command'))) {
  return { phase: 'coding', message: 'Implementing code changes...' };
}
```

**Problem**: This assumes tool usage = coding, but:
1. The Planner agent uses tools to explore the codebase
2. The hierarchy events correctly emit `executionPhase="planning"` from Python
3. This log-based detection overrides the authoritative source

**Two competing phase sources**:
1. **Log parsing** (`parseExecutionPhase`) - heuristic based on text patterns
2. **Hierarchy events** - explicit `executionPhase` field from Python

The hierarchy events are the authoritative source but log parsing is overriding them.

## Solution Design

**Option A: Remove tool-based phase transition (Recommended)**
- Remove or guard the tool usage pattern from triggering coding phase
- Only transition to coding when we have explicit markers or clear coding-specific patterns
- Pros: Simple, minimal risk
- Cons: Might delay phase transition slightly in some cases

**Option B: Respect hierarchy event phase as override**
- Track the last phase from hierarchy events
- Don't allow log parsing to override a phase that was set by hierarchy event
- Pros: Clean separation of concerns
- Cons: More complex, requires state coordination

**Option C: Add agent-type context to log parsing**
- Pass agent type (planner vs coder) to parseExecutionPhase
- Only trigger tool-based transition for coder agents
- Pros: Most accurate
- Cons: Requires refactoring the interface

**Recommended: Option A** - Remove tool-based phase transition, rely on explicit markers.

## Implementation Phases

### Phase 1: Fix Phase Detection Logic

**Objective**: Prevent incorrect phase transitions based on tool usage alone

**Sequential Tasks** (single file change):

1. **Task 1A**: Modify `parseExecutionPhase()` in `agent-events.ts`
   - Remove or significantly restrict the tool usage pattern detection (lines 113-118)
   - Only allow transition to coding when we have explicit markers like:
     - `__TASK_LOG_PHASE_START__:{"phase":"coding"}`
     - Text patterns: "coder agent", "starting coder", "starting implementation"
     - Subtask progress patterns (working on specific subtask)
   - Keep the structured markers as the primary phase detection mechanism

**Files to Modify**:
- `/Users/aiml/Projects/forge/Auto-Claude/auto-claude-ui/src/main/agent/agent-events.ts` - Remove/restrict tool-based phase transition

**Phase Verification**:
- [ ] TypeScript compiles without errors
- [ ] Planner agent running shows "Planning" badge on TaskCard
- [ ] Coder agent running shows "Coding" badge on TaskCard
- [ ] QA review phase shows correct badge

**Phase Review Gate**:
- [ ] Run `principal-code-reviewer` agent
- [ ] Address any issues before proceeding

### Phase 2: Test and Verify

**Objective**: Ensure the fix works correctly across different scenarios

**Sequential Tasks**:
1. Start a new task and verify:
   - During planning phase → TaskCard shows "Planning"
   - During coding phase → TaskCard shows "Coding"
   - During QA phase → TaskCard shows "QA Review"
2. Verify the detail view (Logs tab) still works correctly
3. Verify the PhaseProgressIndicator component works correctly

## Testing Strategy
- Manual testing: Start a task and observe phase badge transitions
- Verify no regression in existing phase detection for coding, QA, completion

## Rollback Plan
- Revert the single edit to `agent-events.ts`

## Risks and Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Phase transition to coding is delayed | Low | Low | Explicit markers are already emitted frequently |
| Other phase detection breaks | Low | Medium | Only modifying one specific pattern |

## Open Questions
- None - the fix is straightforward

---
**USER: Please review this plan. Edit any section directly, then confirm to proceed.**
