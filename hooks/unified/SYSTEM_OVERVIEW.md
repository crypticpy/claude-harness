# Claude Code Memento System - Complete Overview

> **"Like the movie Memento - Claude has a trusted advisor with perfect memory"**

## The Problem

Claude Code's context window compacts every ~154K tokens. After compaction, Claude loses detailed memory of:
- What files were edited and why
- Specific bugs that were fixed
- Design decisions that were made
- Failed approaches that were tried

This leads to:
- Re-introducing bugs that were already fixed
- Asking the same questions multiple times
- Forgetting architectural decisions
- Wasting time on approaches that already failed

## The Solution: Memento Architecture

We've built a **dual-memory system**:

1. **Claude's Active Memory** - Current context window (~154K tokens, compacts regularly)
2. **Memento Advisor** - GPT-4.1 with 1M token context, maintains perfect recall of ALL operations

Think of GPT-4.1 as Claude's Leonard (from Memento) - a trusted friend who never forgets and can be consulted anytime.

---

## System Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code Agent                        │
│                  (Active Context Window)                     │
└────────────────────┬────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
    ┌────▼─────┐          ┌─────▼────┐
    │  Hooks   │          │   MCP    │
    │  System  │          │  Tools   │
    └────┬─────┘          └─────┬────┘
         │                      │
         ▼                      ▼
┌────────────────────────────────────────┐
│         Rolling Log System             │
│    (All operations timestamped)        │
│  ~/.claude/hooks/unified/logs/         │
│    • session-{id}.jsonl                │
│    • file-edits.json                   │
└────────────────┬───────────────────────┘
                 │
                 ▼
        ┌────────────────┐
        │   GPT-4.1      │
        │   Memento      │
        │   Advisor      │
        │  (1M tokens)   │
        └────────────────┘
```

---

## How It Works: Event Flow

### 1. **Session Start**
```
User starts Claude Code
    ↓
SessionStart hook runs
    ↓
Injects: Git status + Active TODOs
```

**What Claude Sees:**
```markdown
## 🚀 Session Context

### Uncommitted Changes
```
 M src/auth.ts
 M tests/auth.test.ts
```

### Active TODOs
```
src/auth.ts:42:  TODO: Add rate limiting
src/api.ts:156:  TODO: Improve error messages
```
```

---

### 2. **User Prompt Submission**
```
User: "Fix the auth bug"
    ↓
UserPromptSubmit hook runs (unified-hook.mjs prompt)
    ↓
Four modules execute in parallel:
    1. Context Report    → Token usage warning
    2. Skill Activation  → Suggest relevant skills
    3. Session Memory    → Inject post-compaction memory
    4. Edit History      → Warn about repeated edits
    ↓
All outputs injected into Claude's context BEFORE it sees the prompt
```

**Example Injections:**

**Context Report:**
```
[🟢 45K/154K (29%)]
```

**Skill Activation:**
```
🎯 SKILL ACTIVATION CHECK

📚 RECOMMENDED SKILLS:
  → context-layer

💡 PROACTIVE HINTS:
  Use semantic_lookup for file summaries, impact_check before edits
  Tools: impact_check, semantic_lookup, symbol_context, what_changed, brain_search

ACTION: Use Skill tool BEFORE responding
```

**Edit History Warning:**
```
📝 FILE HISTORY: `src/auth.ts` has been edited 3× this session
Recent changes:
  1. Fixed token validation logic
  2. Added error handling for expired tokens
  3. Refactored authentication flow
```

**Session Memory (after compaction):**
```xml
<session-memory>
Compaction #1 | Session: 2h 15m

Project: Working on authentication system in main codebase
Direction: Fixing rate limiting bugs and improving error handling

Narrative: Started by investigating rate limit bypass. Discovered token validation 
was incorrectly handling expired tokens. Implemented proper expiration checks and 
improved error messages.

History:
  1. Identified token validation bug in auth middleware
  2. Added proper error handling for expired tokens
  3. Implemented rate limiting using Redis
  4. Created comprehensive test suite for auth flows
</session-memory>
```

---

### 3. **File Edit**
```
Claude edits src/auth.ts
    ↓
PostToolUse hook runs (unified-hook.mjs post-edit)
    ↓
Two things happen:
    1. Auto-format (prettier/black/etc)
    2. Log operation + background enrichment
```

**What Happens:**

1. **Auto-Format** (immediate, synchronous)
   - Detects file extension (`.ts`)
   - Runs `npx --yes prettier --write src/auth.ts`
   - Code is formatted before Claude sees the result

2. **Rolling Log** (background, async)
   ```json
   {
     "timestamp": "2026-01-19T07:14:51.000Z",
     "tool_name": "Edit",
     "tool_input": { "file_path": "src/auth.ts", "diffs": [...] },
     "output_summary": "Successfully edited file...",
     "metadata": {
       "tool": "Edit",
       "file": "src/auth.ts",
       "ext": ".ts"
     }
   }
   ```

3. **Edit Tracking** (background, async)
   ```json
   {
     "files": {
       "src/auth.ts": {
         "editCount": 3,
         "firstEdit": "2026-01-19T05:00:00Z",
         "lastEdit": "2026-01-19T07:14:51Z",
         "sessions": {
           "abc-123": {
             "count": 3,
             "edits": [
               {
                 "timestamp": "2026-01-19T05:30:00Z",
                 "summary": "Fixed token validation logic"
               },
               {
                 "timestamp": "2026-01-19T06:15:00Z",
                 "summary": "Added error handling for expired tokens"
               },
               {
                 "timestamp": "2026-01-19T07:14:51Z",
                 "summary": null  // Will be enriched in background
               }
             ]
           }
         }
       }
     }
   }
   ```

4. **Background Enrichment** (async, non-blocking)
   - Calls GPT-4o-mini with the edit details
   - Generates 1-sentence summary (max 80 chars)
   - Updates the edit entry in the database

---

### 4. **Turn End**
```
Claude finishes responding
    ↓
Stop hook runs (unified-hook.mjs stop)
    ↓
Quality gates execute:
    • TypeScript: npx tsc --noEmit
    • (Add more as needed)
```

**Why End-of-Turn?**
- Runs once per conversation turn instead of after every single edit
- Faster feedback loop
- Less interruption during multi-file changes

---

### 5. **Context Compaction**
```
Context reaches ~154K tokens
    ↓
Claude Code triggers compaction
    ↓
PreCompact hook runs (unified-hook.mjs precompact)
    ↓
Session Memory module:
    1. Reads transcript since last compaction
    2. Calls GPT-4o-mini to extract:
       - Project context (1 line)
       - Overall direction (1-2 sentences)
       - 3-5 key points
       - Long-term narrative (2-3 sentences)
    3. Saves to memories/{session-id}.json
    ↓
Claude Code performs compaction
    ↓
On next prompt, session memory is re-injected
```

**Memory Evolution:**

*After First Compaction:*
```json
{
  "compactionCount": 1,
  "projectContext": "Authentication system refactor",
  "overallDirection": "Fixing rate limiting and token validation",
  "keyPoints": [
    "Fixed token expiration bug",
    "Added Redis rate limiting",
    "Created test suite"
  ]
}
```

*After Second Compaction:*
```json
{
  "compactionCount": 2,
  "projectContext": "Authentication system refactor",
  "overallDirection": "Fixing rate limiting and token validation",
  "keyPoints": [
    "Fixed token expiration bug",
    "Added Redis rate limiting",
    "Created test suite",
    "Integrated with frontend auth flow",
    "Fixed session persistence bug"
  ],
  "longTermNarrative": "Started with token validation issues. Implemented Redis-based rate limiting. Fixed multiple edge cases in session handling. System now stable with comprehensive tests."
}
```

---

## The Memento Advisor: MCP Tools

These three tools let Claude consult its perfect-memory advisor:

### 1. `recall_history` - Ask About Past Operations

**Use Case:** "What have I done in the past hour?"

```typescript
await use_mcp_tool("context-layer", "recall_history", {
  query: "What changes did I make to the authentication system?",
  lookback: "session"  // or "day", "week", "all"
});
```

**What Happens:**
1. Loads operation logs (up to 800K tokens)
2. Sends to GPT-4.1 with your question
3. GPT-4.1 analyzes the entire history and answers

**Example Response:**
```
You made several changes to the authentication system:

1. Fixed token validation bug in auth.ts (5:30 PM) - The middleware wasn't 
   properly checking token expiration

2. Added Redis rate limiting (6:15 PM) - Implemented sliding window rate 
   limiter with 100 requests/minute

3. Created test suite (6:45 PM) - Added comprehensive tests covering all 
   auth flows including edge cases

The changes are complete and all tests are passing.
```

### 2. `file_edit_history` - See What Changed in a File

**Use Case:** "How many times have I edited this file?"

```typescript
await use_mcp_tool("context-layer", "file_edit_history", {
  filePath: "src/auth.ts",
  sessionId: "optional-specific-session"
});
```

**Response:**
```json
{
  "filePath": "src/auth.ts",
  "totalEdits": 12,
  "sessionEdits": 3,
  "firstEdit": "2026-01-18T10:00:00Z",
  "lastEdit": "2026-01-19T07:14:51Z",
  "recentChanges": [
    {
      "timestamp": "2026-01-19T05:30:00Z",
      "summary": "Fixed token validation logic"
    },
    {
      "timestamp": "2026-01-19T06:15:00Z",
      "summary": "Added error handling for expired tokens"
    },
    {
      "timestamp": "2026-01-19T07:14:51Z",
      "summary": "Refactored authentication flow"
    }
  ]
}
```

### 3. `search_tool_history` - Find Specific Operations

**Use Case:** "When did I last run tests?"

```typescript
await use_mcp_tool("context-layer", "search_tool_history", {
  toolName: "Bash",
  since: "2026-01-19T00:00:00Z",
  limit: 10
});
```

**Response:**
```json
{
  "matches": [
    {
      "timestamp": "2026-01-19T06:50:00Z",
      "tool": "Bash",
      "summary": "npm test -- auth.test.ts"
    },
    {
      "timestamp": "2026-01-19T07:10:00Z",
      "tool": "Bash",
      "summary": "npx tsc --noEmit"
    }
  ],
  "totalMatches": 2
}
```

---

## Smart Features

### 1. **Edit History Warnings** (Automatic)

When you mention a file that's been edited multiple times, the system automatically warns you:

```
📝 FILE HISTORY: `src/auth.ts` has been edited 3× this session
Recent changes:
  1. Fixed token validation logic
  2. Added error handling for expired tokens
  3. Refactored authentication flow
```

This prevents:
- Re-introducing bugs
- Forgetting what was already tried
- Asking "what did I change?" repeatedly

### 2. **High Churn Detection**

If a file has been edited 10+ times across 3+ sessions, you get a warning:

```
⚠️ HIGH CHURN FILES (may need architectural attention):
  • src/auth.ts (15 edits across 4 sessions)
```

This indicates:
- The code might have design issues
- The file is overly complex
- Consider refactoring or breaking it up

### 3. **Background Enrichment**

Every file edit gets summarized in the background (no waiting):
- Uses GPT-4o-mini (fast, cheap)
- Generates 1-sentence summary
- Stored for future reference

Cost: ~$0.0001 per edit

---

## Configuration

All settings in `~/.claude/hooks/unified/config.json`:

### LLM Configuration

```json
{
  "llm": {
    "recall": {
      "model": "openai/gpt-4.1",
      "baseUrl": "https://openrouter.ai/api/v1",
      "maxTokens": 2000
    },
    "summarize": {
      "model": "openai/gpt-4o-mini",
      "baseUrl": "https://openrouter.ai/api/v1",
      "maxTokens": 500
    }
  }
}
```

**API Key Auto-Detection:**
1. `~/.claude-code-fast-permission-hook/config.json` (from cf-approve)
2. `OPENROUTER_API_KEY` environment variable
3. `OPENAI_API_KEY` environment variable

### Formatting Configuration

```json
{
  "formatting": {
    "enabled": true,
    "extensions": {
      ".ts": "npx --yes prettier --write",
      ".py": "/Users/aiml/.pyenv/shims/black -q",
      ".go": "/opt/homebrew/bin/gofmt -w"
    }
  }
}
```

**To disable formatting:** Set `"enabled": false`

**To disable specific extensions:** Remove the line

### Rolling Log Configuration

```json
{
  "rolling_log": {
    "maxEntries": 10000,
    "maxAgeDays": 30,
    "summarizeAfterEdits": 2,
    "backgroundEnrichment": true
  }
}
```

- `summarizeAfterEdits: 2` - Warn after 2nd edit of same file
- `backgroundEnrichment: true` - Auto-summarize edits with LLM

### Quality Gates Configuration

```json
{
  "qualityGates": {
    "onStop": {
      "enabled": true,
      "commands": {
        "typescript": "npx tsc --noEmit",
        "eslint": "npx eslint . --max-warnings 0",
        "default": null
      }
    }
  }
}
```

Runs at end of each conversation turn (Stop hook).

---

## Cost Breakdown

| Operation | Model | Cost per Use | Frequency |
|-----------|-------|--------------|-----------|
| Edit summary | GPT-4o-mini | $0.0001 | Every file edit |
| Session memory | GPT-4o-mini | $0.0002 | Every compaction (~154K tokens) |
| Recall query | GPT-4.1 | $0.001-0.005 | When you ask |

**Typical Session:**
- 50 file edits: $0.005
- 2 compactions: $0.0004
- 5 recall queries: $0.015

**Total: ~$0.02 per session**

---

## Benefits

### 1. **Perfect Recall**
Claude can ask "what did I do 2 hours ago?" and get accurate answers from GPT-4.1.

### 2. **Fewer Bugs**
Edit history warnings prevent re-introducing bugs that were already fixed.

### 3. **Better Quality**
End-of-turn quality gates catch issues before you move on.

### 4. **Consistent Code**
Auto-formatting ensures all code follows style guidelines.

### 5. **Architectural Insights**
High churn detection highlights files that need refactoring.

### 6. **Session Continuity**
Session memory survives compactions, maintaining project context.

---

## Usage Examples

### Example 1: Debugging a Recurring Issue

**You:** "Fix the auth bug"

*Claude fixes it*

**2 hours later...**

**You:** "The auth bug is back"

*Claude checks:*
```typescript
await use_mcp_tool("context-layer", "file_edit_history", {
  filePath: "src/auth.ts"
});
```

*Sees:*
```
totalEdits: 5
recentChanges:
  - Fixed token validation (2 hours ago)
  - Added error handling (1.5 hours ago)
  - Reverted changes due to tests failing (1 hour ago)  ← AH HA!
```

**Claude:** "I see I tried to fix this earlier but reverted it because tests failed. Let me check the test failures and fix both the bug AND the tests this time."

### Example 2: After Compaction

**Context compacts at 154K tokens**

*On next prompt, Claude sees:*
```xml
<session-memory>
Compaction #1 | Session: 3h

Project: E-commerce checkout flow
Direction: Implementing payment processing with Stripe

History:
  1. Integrated Stripe SDK
  2. Created payment intent flow
  3. Fixed webhook signature verification
  4. Added comprehensive error handling
</session-memory>
```

Claude still knows what's going on, even though detailed conversation history was compacted.

### Example 3: Understanding Changes

**You:** "What have I been working on this session?"

*Claude:*
```typescript
await use_mcp_tool("context-layer", "recall_history", {
  query: "Summarize all work done this session",
  lookback: "session"
});
```

*GPT-4.1 responds:*
```
This session focused on the e-commerce checkout flow:

1. Stripe Integration (9:00-10:30 AM)
   - Integrated Stripe SDK
   - Set up payment intents
   - Configured webhook endpoints

2. Bug Fixes (10:30-11:15 AM)
   - Fixed webhook signature verification
   - Added retry logic for failed payments
   - Improved error messaging

3. Testing (11:15 AM-12:00 PM)
   - Created comprehensive test suite
   - Added integration tests for payment flow
   - All tests passing

Current state: Payment processing is complete and tested.
```

---

## File Structure

```
~/.claude/
├── hooks/
│   ├── unified/                      # New unified system
│   │   ├── unified-hook.mjs         # Entry point
│   │   ├── config.json              # Configuration
│   │   ├── skill-rules.json         # Skill activation rules
│   │   ├── skill-state.json         # Session tracking
│   │   ├── README.md                # Quick reference
│   │   ├── SYSTEM_OVERVIEW.md       # This file
│   │   ├── modules/
│   │   │   ├── context-report.mjs   # Token warnings
│   │   │   ├── skill-activation.mjs # Skill suggestions
│   │   │   ├── session-memory.mjs   # Compaction memory
│   │   │   ├── edit-history.mjs     # Edit tracking
│   │   │   ├── rolling-log.mjs      # Operation logging
│   │   │   ├── format-lint.mjs      # Auto-formatting
│   │   │   ├── quality-gates.mjs    # Quality checks
│   │   │   └── session-start.mjs    # Session context
│   │   ├── logs/
│   │   │   ├── {session-id}.jsonl   # Session operations
│   │   │   └── file-edits.json      # Edit tracking DB
│   │   └── memories/
│   │       └── {session-id}.json    # Compaction memories
│   │
│   ├── context-reporter/            # OLD (still works as backup)
│   ├── SkillActivationHook/         # OLD (still works as backup)
│   └── SessionMemory/               # OLD (still works as backup)
│
└── plugins/
    └── context-layer/
        ├── dist/
        │   └── tools/
        │       └── memento-tools.js # MCP tools (compiled)
        └── src/
            └── tools/
                └── memento-tools.ts # MCP tools (source)
```

---

## Troubleshooting

### Hook Not Running

```bash
# Test directly
echo '{"session_id":"test","prompt":"test"}' | \
  node ~/.claude/hooks/unified/unified-hook.mjs prompt
```

### No API Key

```bash
# Set environment variable
export OPENROUTER_API_KEY="sk-or-v1-..."

# Or configure cf-approve
cf-approve config
```

### Formatting Not Working

1. Check config: `cat ~/.claude/hooks/unified/config.json | grep -A 15 formatting`
2. Verify tool exists: `which prettier` or `which black`
3. Test manually: `npx --yes prettier --write test.ts`

### MCP Tools Not Available

1. Rebuild context-layer: `cd ~/.claude/plugins/context-layer && npm run build`
2. Check settings: `cat ~/.claude/settings.json | grep context-layer`
3. Restart Claude Code

---

## Next Steps

1. **Try the MCP tools** - Ask Claude to use `recall_history` to see past operations
2. **Edit a file twice** - See the automatic edit history warning
3. **Let context compact** - See how session memory survives
4. **Check the logs** - Look at `~/.claude/hooks/unified/logs/` to see what's captured

The system runs automatically - you don't need to do anything special. Claude now has a perfect memory advisor!
