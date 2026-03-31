# Swarm Agent Communication Guidelines

## Philosophy: Self-Service First, Ask Second

In a decentralized swarm, agents should be **autonomous investigators** before becoming **communicators**. The system provides multiple information channels - use them in order.

## Information Hierarchy (Check in Order)

### 1. **File Locks** (Instant)
```bash
cat .swarm/file-locks.json
```
**Shows**: Who's working on what, when they started
**Use for**: Avoiding conflicts, knowing who to ask about a file

### 2. **Task Board** (Instant)
```bash
cat .swarm/board.json
```
**Shows**: All tasks, dependencies, status, assignees
**Use for**: Understanding project state, finding available work

### 3. **Decision Log** (Instant)
```bash
cat .swarm/decisions.jsonl | tail -20
```
**Shows**: Architectural decisions, rationale, context
**Use for**: Understanding "why" behind design choices

### 4. **Git History** (Fast)
```bash
git log --oneline --all -20
git log -p src/auth/oauth.ts
```
**Shows**: What changed, when, by whom
**Use for**: Understanding implementation details, patterns

### 5. **Code Reading** (Fast)
```bash
# Read the actual implementation
cat src/auth/oauth.ts
```
**Shows**: Exactly how something works
**Use for**: Learning patterns, understanding APIs

### 6. **Messages** (Async)
```bash
cat .swarm/messages/<agentId>/*.json
```
**Shows**: Direct communication from other agents
**Use for**: Explicit coordination needs

### 7. **Send Message** (Last Resort)
```bash
swarm_send_message(...)
```
**Use when**: Information is not available anywhere else

## Decision Tree: Should I Send a Message?

```
Question arises
    ↓
Is it in file locks? → YES → Read locks
    ↓ NO
Is it in task board? → YES → Read board
    ↓ NO
Is it in decision log? → YES → Read decisions
    ↓ NO
Is it in git history? → YES → Read commits
    ↓ NO
Is it in the code? → YES → Read code
    ↓ NO
Is it time-sensitive? → NO → Can wait for PR review
    ↓ YES
Send message
```

## Message Types (Use Sparingly)

### 1. **Blocking Question** (Priority: HIGH)
```typescript
{
  type: 'blocking_question',
  content: {
    blocked_task: 'task-frontend-2',
    question: 'What endpoint does getUserProfile hit?',
    needed_by: '2026-01-19T16:00:00Z',
    context: 'Building profile component, need API contract'
  }
}
```
**When**: You literally cannot proceed without this information
**Example**: API endpoint unknown, interface signature needed

### 2. **Breaking Change Warning** (Priority: HIGH)
```typescript
{
  type: 'breaking_change',
  content: {
    task: 'task-backend-5',
    change: 'Renaming /api/user to /api/v2/users',
    files: ['src/api/routes.ts'],
    impact: 'All frontend API calls need updating',
    timeline: 'Merging in 2 hours'
  }
}
```
**When**: Your change will break someone else's work
**Example**: API signature change, file rename, module restructure

### 3. **Design Consensus Request** (Priority: MEDIUM)
```typescript
{
  type: 'design_consensus',
  content: {
    decision_needed: 'State management library choice',
    options: ['Redux', 'Zustand', 'Jotai'],
    context: 'Building user state management',
    deadline: '2026-01-19T18:00:00Z',
    current_thinking: 'Leaning toward Zustand for simplicity'
  }
}
```
**When**: Multiple valid approaches, need team alignment
**Example**: Library choice, architecture pattern, file structure

### 4. **Coordination Request** (Priority: MEDIUM)
```typescript
{
  type: 'coordination',
  content: {
    task: 'task-refactor-1',
    action: 'Need to refactor auth.ts into 3 files',
    timing: 'Tomorrow morning',
    affected_tasks: ['task-frontend-3', 'task-backend-2'],
    question: 'Can you pause work on auth-related tasks?'
  }
}
```
**When**: Planning work that affects others
**Example**: Large refactoring, file splits, module reorganization

### 5. **Information Share** (Priority: LOW)
```typescript
{
  type: 'fyi',
  content: {
    info: 'Found great auth middleware pattern',
    location: 'src/middleware/auth-v2.ts',
    context: 'Might be useful for your OAuth work',
    optional: true
  }
}
```
**When**: Helpful but not critical information
**Better**: Log as decision or document in code comments

## Anti-Patterns (Don't Do This)

### ❌ Asking What's Already Visible
```
Bad:  "What's the current status of task-auth-1?"
Good: Check task board → see it's in review
```

### ❌ Asking How Code Works
```
Bad:  "How did you implement OAuth refresh?"
Good: Read src/auth/refresh.ts + git log
```

### ❌ Requesting Permission
```
Bad:  "Can I work on login.ts now?"
Good: Check file locks → if unlocked, claim task
```

### ❌ Progress Updates
```
Bad:  "I'm 50% done with the profile UI"
Good: Task board shows in_progress status
```

### ❌ General Discussion
```
Bad:  "What do you think about TypeScript 5.3?"
Good: Save for team meetings, not swarm messages
```

## Best Practices

### 1. **Exhaust Self-Service First**
```typescript
// Before messaging, agent should:
1. Read task board
2. Check file locks
3. Read decision log
4. Read git history
5. Read actual code
6. Check messages to me
7. Only then: send message
```

### 2. **Be Specific in Messages**
```typescript
// Bad
{ question: "Can you help with auth?" }

// Good
{
  question: "What's the expected JWT expiry time?",
  context: "Implementing token refresh in task-auth-3",
  blocking: true,
  checked: ["Read oauth.ts", "Checked decision log", "No expiry constant found"]
}
```

### 3. **Use Decision Log for Permanent Info**
```typescript
// Instead of messaging all agents:
swarm_log_decision({
  decision: "JWT tokens expire after 1 hour",
  rationale: "Balance security vs UX",
  context: "task-auth-1"
});

// Other agents read this when needed
```

### 4. **Batch Questions**
```typescript
// Bad: 3 separate messages
message("What's the API endpoint?")
message("What's the auth middleware?")
message("What's the error format?")

// Good: 1 message
message({
  questions: [
    "API endpoint for user profile?",
    "Auth middleware to use?",
    "Expected error response format?"
  ],
  context: "Building profile component, task-frontend-2"
})
```

### 5. **Message Expiry**
```typescript
// Mark messages with urgency
{
  type: 'blocking_question',
  urgent: true,
  expires_at: '2026-01-19T16:00:00Z',
  fallback: 'Will assume /api/users if no response'
}
```

## Autonomous Agent Workflow

### Ideal Flow (No Messages Needed)
```
1. Session start → See swarm status
2. Read decision log → Understand architecture
3. Query board → Find available task
4. Read task dependencies → See what's prerequisite
5. Claim task → Lock files
6. Read related code → Understand patterns
7. Implement feature → Follow conventions
8. Complete task → Unlock files
9. Git push → Share work
10. Other agents see completion → Claim next tasks
```

### When Messages Become Necessary
```
1. Session start → See swarm status
2. Query board → Find task
3. Read code → Notice missing API contract
4. Check decision log → No mention of API design
5. Check messages → No existing answers
6. **Send blocking_question** → Need API contract
7. Continue other work → Switch to different task
8. Receive response → Return to original task
9. Complete task → Document in decision log for future
```

## Metrics: Healthy Communication Patterns

### Good Indicators
- **Message Rate**: <1 message per task completed
- **Self-Service Rate**: >90% of questions answered without messaging
- **Response Time**: Messages answered within 1 hour
- **Decision Log Growth**: Steady increase (captures learnings)
- **Task Velocity**: Tasks complete without blocking

### Warning Signs
- Message Rate >3 per task (too chatty)
- Same questions asked repeatedly (poor documentation)
- Long message threads (should be in decision log)
- Many "FYI" messages (noise)
- Agents waiting for responses (blocking)

## Advanced: Message Priorities

### Auto-Handle Priority
```typescript
// System can auto-respond to these
{
  type: 'status_query',
  answer_from: 'task_board'  // Don't wait for human
}
```

### Immediate Priority
```typescript
// Break the agent's current work
{
  type: 'breaking_change',
  priority: 'immediate',
  interrupt: true
}
```

### Async Priority
```typescript
// Check at next natural breakpoint
{
  type: 'fyi',
  priority: 'low',
  read_when: 'convenient'
}
```

## Implementation: Smart Agent Prompt

When Claude considers messaging, the session hook could inject:

```markdown
## Before Sending a Message

Have you checked:
- [ ] Task board (.swarm/board.json)
- [ ] File locks (.swarm/file-locks.json)
- [ ] Decision log (.swarm/decisions.jsonl)
- [ ] Git history (git log -p <file>)
- [ ] Actual code (read the file)
- [ ] Existing messages

If yes to all and still need info → send message
If no → check those sources first
```

## Conclusion

**Communication is a last resort, not a first instinct.**

The swarm is designed for **autonomous operation** with **minimal coordination overhead**. Agents should be:

1. **Self-sufficient** - Read first, ask later
2. **Decisive** - Make informed choices from available data
3. **Documenting** - Log decisions for future agents
4. **Respectful** - Don't interrupt unless necessary

**Good swarms run quietly.** If you're sending many messages, something's wrong with:
- Task decomposition (tasks too interdependent)
- Documentation (decisions not logged)
- Architecture (too much coupling)

**Best case**: Agents work independently, coordinate via git, meet at PR review
**Acceptable**: Occasional messages for critical blocking issues
**Problem**: Constant back-and-forth, waiting for responses

The system provides the tools. Use messaging wisely.
