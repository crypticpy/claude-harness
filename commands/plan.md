---
name: plan
description: Create a detailed implementation plan with parallel exploration before any code changes
model: opus
argument-hint: <task description>
---

You are entering PLANNING MODE. This is a critical phase that requires thorough exploration and careful analysis before any implementation.

## Core Planning Principles

### Parallel-First Architecture

All plans MUST be designed to maximize parallel execution using sub-agents set to the **Opus model**. When decomposing work:

- **Identify independent workstreams** that can execute simultaneously
- **Avoid file conflicts**: Ensure parallel agents don't edit the same files concurrently
- **Design clear boundaries**: Each parallel task should have well-defined inputs/outputs
- **Minimize dependencies**: Structure phases so tasks within each phase can run in parallel

### Mandatory Quality Gates

Every plan MUST include final verification using specialized review agents:

- **final-review-completeness**: Validates all items completed, no mocks/placeholders/TODOs left behind
- **principal-code-reviewer**: Assesses overall engineering quality and standards compliance

These agents run at the end of each major phase or deliverable, AND again at the end of the full implementation.

### Verification Protocol (MANDATORY)

Three tiers of verification are enforced throughout plan execution:

**Tier 1 — Edit Verification**: After any turn with 3+ file edits, a self-check runs automatically via the Stop hook. Review its output before continuing.

**Tier 2 — Phase Gate**: At the end of each implementation phase, BEFORE starting the next phase:

1. Run `final-review-completeness` agent scoped to this phase's files
2. Run `principal-code-reviewer` agent scoped to this phase's changes
3. ALL critical issues MUST be resolved before proceeding
4. Log phase completion: what was done, what was verified, what issues were found and fixed

**Tier 3 — Plan Completion**: After all phases are done, before reporting completion to the user:

1. Run `/freview` (full review across all session work)
2. ALL critical and high issues must be resolved
3. Present the final review summary to the user with scores

Skipping any tier is NOT permitted. If a phase gate reveals critical issues, they must be fixed before the next phase begins — even if this means re-planning.

---

## Phase 1: Task Understanding

First, clearly state your understanding of the task: $ARGUMENTS

If the task is unclear, use AskUserQuestion to clarify before proceeding.

## Phase 2: Parallel Exploration

Spawn multiple Explore agents in parallel using the Task tool with subagent_type='Explore'. Each agent should focus on a specific aspect:

1.  **Architecture Explorer**
    : Find the overall project structure, entry points, and how components connect
2.  **Feature Explorer**
    : Find existing similar features or patterns that relate to the task
3.  **Dependency Explorer**
    : Identify dependencies, imports, and modules that will be affected
4.  **Test Explorer**
    : Find existing test patterns and testing infrastructure

For each Explore agent, instruct them to:

- Return ONLY hypotheses (not conclusions) about what they found
- Provide FULL file paths for every relevant file
- NOT read file contents deeply - just identify locations
- Be thorough but efficient - they are scouts, not implementers

Example prompt for an Explore agent:

```
Explore the codebase to find [specific aspect]. Return:
1. Your hypothesis about how [aspect] works
2. Full paths to all relevant files (e.g., /Users/.../src/file.ts:lineNumber)
3. Any patterns you noticed


Do NOT draw conclusions - just report findings. The main agent will verify.
```

## Phase 3: Hypothesis Verification

After receiving results from all Explore agents:

1. Read each file that the Explore agents identified (use full paths)
2. Verify or refute each hypothesis
3. Build a complete mental model of:
   - Current architecture
   - Affected components
   - Integration points
   - Potential risks

## Phase 4: Plan Creation

Create a detailed plan using the create_plan tool with this structure:

```markdown
# Implementation Plan: [Task Title]

Created: [Date]
Status: PENDING APPROVAL

## Summary

[2-3 sentences describing what will be accomplished]

## Scope

### In Scope

- [List what will be changed]

### Out of Scope

- [List what will NOT be changed]

## Prerequisites

- [Any requirements before starting]

## Parallel Execution Strategy

[Describe how work will be parallelized across sub-agents]

### Workstream Analysis

| Workstream | Agent Type       | Files Owned                         | Dependencies                       |
| ---------- | ---------------- | ----------------------------------- | ---------------------------------- |
| [Stream 1] | [Opus sub-agent] | [Files this agent owns exclusively] | [What it needs from other streams] |

### File Ownership Matrix

[Map which files each parallel agent will modify to prevent conflicts]

## Implementation Phases

### Phase 1: [Phase Name]

**Objective**: [What this phase accomplishes]

**Parallel Tasks** (run simultaneously via Opus sub-agents):

1. **Task 1A**: [Description] - Owns: [files]
2. **Task 1B**: [Description] - Owns: [files]
3. **Task 1C**: [Description] - Owns: [files]

**Sequential Tasks** (must run in order):

1. [Task that depends on parallel work completing]

**Files to Modify**:

- `path/to/file.ts` - [What changes] - Owner: [Task ID]
- `path/to/another.ts` - [What changes] - Owner: [Task ID]

**New Files to Create**:

- `path/to/new.ts` - [Purpose] - Owner: [Task ID]

**Phase Verification**:

- [ ] [How to verify this phase works]

**Phase Review Gate** (BLOCKING — must pass before next phase):

- [ ] Run `final-review-completeness` agent on this phase's files
- [ ] Run `principal-code-reviewer` agent on this phase's changes
- [ ] ALL critical issues resolved (not deferred)
- [ ] High issues resolved or explicitly accepted by user
- [ ] Phase gate logged: findings, fixes, sign-off

### Phase 2: [Phase Name]

[Same structure as Phase 1, including Parallel Tasks and Review Gate]

### Phase 3: [Phase Name]

[Same structure as Phase 1, including Parallel Tasks and Review Gate]

## Final Deliverable Review

**BLOCKING — plan cannot be marked complete until this passes.**

1. Run `/freview` slash command for comprehensive dual-agent review
2. ALL critical and high issues must be resolved
3. Present aggregated review summary with scores to the user
4. User must explicitly approve before plan is marked COMPLETE

If the final review reveals new critical issues, they must be fixed and the review re-run.

## Testing Strategy

- [Unit tests to add/modify]
- [Integration tests]
- [Manual testing steps]

## Rollback Plan

- [How to undo changes if needed]

## Risks and Mitigations

| Risk                         | Likelihood   | Impact       | Mitigation                  |
| ---------------------------- | ------------ | ------------ | --------------------------- |
| [Risk 1]                     | Low/Med/High | Low/Med/High | [How to mitigate]           |
| File conflict between agents | Med          | High         | Clear file ownership matrix |

## Open Questions

- [Any unresolved questions for the user]

---

**USER: Please review this plan. Edit any section directly, then confirm to proceed.**
```

## Phase 5: User Confirmation

After writing the plan file:

1. Tell the user the plan has been created at the specified path
2. Ask them to review and edit the plan if needed
3. Wait for explicit confirmation before proceeding
4. DO NOT write or edit any implementation files until confirmed

## Phase 6: Plan Re-read

Once the user confirms:

1. Re-read the plan file completely (user may have edited it)
2. Note any changes the user made
3. Acknowledge the changes before proceeding
4. Only then begin implementation following the plan exactly

## Critical Rules

- NEVER skip the exploration phase
- NEVER write implementation code during planning
- NEVER assume - verify by reading files
- ALWAYS get user confirmation before implementing
- ALWAYS re-read the plan after user confirms (they may have edited it)
- The plan must be detailed enough that another developer could follow it
- Each phase should be independently verifiable
- **ALWAYS design for parallel execution** - maximize use of Opus sub-agents
- **ALWAYS include file ownership** - prevent parallel agents from conflicting
- **ALWAYS run review agents** at phase boundaries and final deliverable
- **NEVER skip the final review** - both completeness and quality reviews are mandatory
- **NEVER skip verification** — all three tiers (edit check, phase gate, plan completion) are mandatory
- **NEVER proceed past a failed phase gate** — fix critical issues first, even if it means re-planning
