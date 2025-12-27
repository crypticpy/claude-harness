---
name: git-commits
description: Git protocol with intelligent commit format
---

# Git Protocol

## 🔄 Mandatory Auto-Commit System

**🚨 CRITICAL**: You MUST create a commit when session work completes. NO EXCEPTIONS.

### Commit Triggers (ANY require immediate commit)

1. ✅ Session reaches completion (all TodoWrite tasks complete)
2. ✅ User completes work session
3. ✅ Significant feature/fix implemented
4. ✅ Before session archival
5. ✅ User explicit request

### Intelligent Commit Orchestration

```
WHEN (All TodoWrite tasks marked complete) THEN {
  0. Detect: Check TodoWrite status for 100% completion
  1. Analyze changes for the session
  2. Generate commit message referencing session
  3. Execute commit with session reference
  4. Report completion to user
  5. Prepare session for archival
}
```

### Pre-Commit Analysis (Enhanced)

- **Scan staged files**: `git diff --cached --name-only`
- **Classify changes**: feat/fix/refactor/docs/style/test
- **Check documentation**: Update README if outdated
- **Group logically**: Decide single vs multi-commit strategy

### Commit Message Generation

**Format**: `{type}: {summary} - Session [number] completed 🤖`

**Types**: feat, fix, refactor, docs, style, test, build, chore

**Examples**:

- `feat: implement user profile system - Session 001 completed 🤖`
- `fix: resolve authentication flow issues - Session 002 completed 🤖`
- `refactor: optimize database connection pooling - Session 003 completed 🤖`

### Multi-Commit Strategy (When Appropriate)

When changes span multiple logical areas:

```bash
# Example: Frontend + Backend + Database changes
git add src/components/* && git commit -m "feat: profile UI components - Auto-commit (1/3) 🤖"
git add src/server/* && git commit -m "feat: profile API endpoints - Auto-commit (2/3) 🤖"
git add supabase/* && git commit -m "feat: profile database schema - Auto-commit (3/3) 🤖"
```

### Execution Protocol

1. **Status Check**: `git status` - understand all changes
2. **Pre-commit Validation**: `npm run lint && npm run typecheck` (if available)
3. **Smart Staging**: Stage related files together
4. **Commit Creation**: Use HEREDOC for complex messages
5. **Verification**: Confirm commit(s) created
6. **User Notification**: Report what was committed

### ⚠️ Compliance Enforcement

Failure to auto-commit when session completes = CRITICAL FAILURE.
This is MANDATORY, not optional. No exceptions.

## Core Git Rules

### Never Do Without Permission

- **NEVER** push (unless explicitly requested)
- **NEVER** force push
- **NEVER** run `git clean -fdx`
- **NEVER** modify git config

### Always Do

- Include commit messages
- Use HEREDOC for multi-line messages
- Check status before operations
- Validate changes before committing

### Branch Strategy

- `main`: Production (never direct push)
- `dev`: Development/staging
- Features: `feature/description`
- Personal: `developer/feature`

---

This protocol ensures intelligent, safe, and mandatory version control.
