---
description: Final review - spawn completeness and code review agents with ultrathink against current session
---

# Final Review Protocol

You are executing a comprehensive final review of the current session's work. This spawns specialized review agents to catch incomplete implementations, code quality issues, and verify production readiness.

## Step 1: Read Session Context

First, read the current session file to understand what work was done:

```
Read: .claude/tasks/session-current.md
```

If no session file exists, check git for recent changes:
```bash
git diff --name-only HEAD~5
git log --oneline -10
```

## Step 2: Assess Scope

Analyze the session to determine review scale:

| Scope | Criteria | Strategy |
|-------|----------|----------|
| **Small** | 1-3 tasks, <6 files, 1 domain | 1 of each agent |
| **Medium** | 4-8 tasks, 6-15 files, 2-3 domains | 1 of each, thorough mode |
| **Large** | 9+ tasks, 16+ files, 4+ domains | Multiple parallel agents |

## Step 3: Spawn Review Agents

Launch BOTH agents in parallel (single message, multiple Task tools):

### Agent 1: final-review-completeness

```
"SESSION REVIEW: Read .claude/tasks/session-current.md for full context.

TASK: Comprehensive completeness audit of all session work.

SCAN FOR:
- TODO/FIXME/HACK comments that indicate unfinished work
- Placeholder code, mock data, or stub implementations
- Incomplete error handling (empty catch blocks, missing validation)
- Unused imports or dead code
- Commented-out code that should be removed
- Missing tests for new functionality
- Hardcoded values that should be configurable
- Console.log statements that should be removed

ULTRATHINK: Engage extended thinking mode. Analyze deeply - don't rush.
Consider edge cases, subtle incompleteness patterns, and integration gaps.
Quality over speed.

DELIVERABLES:
1. Issues list in format: [SEVERITY] file:line - description
   - CRITICAL: Blocks production deployment
   - MODERATE: Should fix before release
   - MINOR: Nice to fix
2. Completeness score (0-100%)
3. Recommended fixes for each issue"
```

### Agent 2: principal-code-reviewer

```
"SESSION REVIEW: Read .claude/tasks/session-current.md for full context.
Also read CLAUDE.md for project standards.

TASK: Expert code review of all session work.

EVALUATE:
- Code correctness and logic errors
- Adherence to project patterns and conventions
- Security: input validation, SQL injection, XSS, auth checks
- Performance: N+1 queries, unnecessary loops, memory issues
- Error handling: proper try/catch, meaningful messages
- Naming conventions and code organization
- Maintainability and readability
- Test coverage adequacy

ULTRATHINK: Engage extended thinking mode for architectural analysis.
Consider long-term maintainability, systemic issues, and design coherence.
Don't just flag issues - explain WHY they matter.

DELIVERABLES:
1. Issues list in format: [SEVERITY] file:line - description + explanation
2. Security concerns (if any)
3. Performance concerns (if any)
4. Code quality score (0-100%)
5. Top 3 recommendations for improvement"
```

## Step 4: Large Scope - Additional Agents

For LARGE sessions (9+ tasks or 16+ files), spawn additional specialized reviewers:

### Additional Completeness Agents (parallel):
- One focused on frontend files
- One focused on backend/API files
- One focused on tests and config

### Additional Code Review Agents (parallel):
- One for security-focused audit
- One for performance-focused audit

All agents receive the ULTRATHINK directive.

## Step 5: Aggregate Results

After all agents complete:

1. **Collect** all findings from agent outputs
2. **Deduplicate** overlapping issues
3. **Prioritize** by severity (CRITICAL > MODERATE > MINOR)
4. **Present** summary to user:

```markdown
## Final Review Summary

**Session**: [session name/number]
**Files Reviewed**: X
**Agents Used**: Y

### Scores
- Completeness: X/100
- Code Quality: Y/100

### Critical Issues (MUST FIX)
- [ ] Issue 1 - file:line - description

### Moderate Issues (SHOULD FIX)
- [ ] Issue 2 - file:line - description

### Minor Issues (NICE TO FIX)
- [ ] Issue 3 - file:line - description

### Security Concerns
- [List any security issues]

### Performance Concerns
- [List any performance issues]

### Recommendations
1. [Top recommendation]
2. [Second recommendation]
3. [Third recommendation]

---
**Next Steps**:
- Fix critical issues before committing
- If all clear, proceed with `/commit`
```

## Critical Rules

- ALWAYS spawn BOTH agents (completeness + code review)
- ALWAYS use ULTRATHINK directive for deep analysis
- ALWAYS use parallel execution (multiple Task tools in one message)
- NEVER skip the aggregation step
- Scale up agents for large sessions
- Present actionable, prioritized findings
