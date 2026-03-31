# Unified Claude Code Hooks - Memento Architecture

**"Like the movie Memento - Claude has a trusted advisor that maintains perfect memory"**

## Overview

This unified hooks system consolidates all hook functionality into a single, maintainable codebase with advanced "Memento" recall capabilities. Claude's context compacts, but the rolling log + GPT-4.1 advisor maintains perfect memory of all operations.

## Architecture

```
unified/
├── unified-hook.mjs        # Entry point - routes events to modules
├── config.json             # Shared configuration
├── skill-rules.json        # Skill activation rules
├── modules/
│   ├── context-report.mjs  # Token usage warnings
│   ├── skill-activation.mjs # Skill suggestions
│   ├── session-memory.mjs  # Memory across compactions
│   ├── edit-history.mjs    # File edit tracking & warnings
│   ├── rolling-log.mjs     # Log all operations
│   ├── format-lint.mjs     # Auto-format on edit
│   ├── quality-gates.mjs   # End-of-turn checks
│   └── session-start.mjs   # Project context injection
└── logs/                   # Rolling conversation logs
    ├── {session-id}.jsonl  # All tool operations
    └── file-edits.json     # File edit tracking DB
```

## Features

### 1. **Rolling Conversation Log**
Every tool operation is logged with timestamps and metadata. Background enrichment summarizes file edits using a mini LLM.

### 2. **Memento Recall (MCP Tools)**
Three new tools added to context-layer:
- `recall_history` - Ask GPT-4.1 about past operations (uses 1M context window)
- `file_edit_history` - See how many times a file was edited and summaries
- `search_tool_history` - Search past tool calls with filters

### 3. **Edit History Warnings**
When Claude mentions a file that's been edited 2+ times this session, automatically inject context about previous changes.

### 4. **Auto-Format**
Runs prettier/black/gofmt automatically after Write|Edit based on file extension.

### 5. **Quality Gates**
End-of-turn typecheck/lint (Stop hook) - runs once per turn instead of after every edit.

### 6. **Session Start Context**
Injects git status + TODOs at session start so Claude knows what's uncommitted.

### 7. **Consolidated Modules**
- Context reporter (token warnings)
- Skill activation (suggest relevant skills)
- Session memory (survive compactions)

## Configuration

Edit `config.json` to customize:

```json
{
  "llm": {
    "recall": {
      "model": "openai/gpt-4.1",  // Long-context advisor
      "maxTokens": 2000
    },
    "summarize": {
      "model": "openai/gpt-4o-mini",  // Fast summaries
      "maxTokens": 500
    }
  },
  "formatting": {
    "enabled": true,
    "extensions": {
      ".ts": "npx prettier --write",
      ".py": "black"
    }
  },
  "rolling_log": {
    "summarizeAfterEdits": 2,  // Warn after 2nd edit
    "backgroundEnrichment": true
  }
}
```

API key is auto-detected from:
1. `~/.claude-code-fast-permission-hook/config.json` (cf-approve)
2. `OPENROUTER_API_KEY` or `OPENAI_API_KEY` env vars

## Hook Events

| Event | Purpose |
|-------|---------|
| `UserPromptSubmit` → `prompt` | Context report + skill activation + memory inject + edit warnings |
| `PreCompact` → `precompact` | Save session memory |
| `PostToolUse` (Write\|Edit) → `post-edit` | Format code + log operation + enrich |
| `Stop` → `stop` | Quality gates (typecheck, lint) |
| `SessionStart` → `session-start` | Git status + TODOs |

## MCP Tools Usage

```typescript
// Ask the Memento advisor about past operations
await use_mcp_tool("context-layer", "recall_history", {
  query: "When did I last edit auth.ts and what changed?",
  lookback: "session"  // or "day", "week", "all"
});

// Get detailed file edit history
await use_mcp_tool("context-layer", "file_edit_history", {
  filePath: "src/components/Auth.tsx"
});

// Search tool call history
await use_mcp_tool("context-layer", "search_tool_history", {
  toolName: "Bash",  // Filter by tool
  since: "2026-01-18T00:00:00Z"
});
```

## Benefits

1. **Perfect Memory**: GPT-4.1 advisor never forgets, even after compactions
2. **Fewer Mistakes**: Edit warnings prevent re-introducing bugs
3. **Consistent Code**: Auto-format on every edit
4. **Better Quality**: End-of-turn checks catch issues
5. **Simplified Maintenance**: One codebase, shared config
6. **Proactive Context**: Claude knows about repeated edits and high-churn files

## Migration from Old Hooks

Old hooks still work but are now redundant:
- `context-reporter/` → `modules/context-report.mjs`
- `SkillActivationHook/` → `modules/skill-activation.mjs`
- `SessionMemory/` → `modules/session-memory.mjs`

The unified system adds:
- Rolling logs
- Memento recall
- Edit history warnings
- Auto-format
- Quality gates
- Session start context

## Cost

- **Rolling log enrichment**: ~$0.0001 per edit (GPT-4o-mini)
- **Memento recall**: ~$0.001-0.005 per query (GPT-4.1, depends on history size)
- **Session memory**: ~$0.0002 per compaction (GPT-4o-mini)

Typical session with 50 edits + 5 recalls + 2 compactions: ~$0.01

## Troubleshooting

**Hook not triggering?**
```bash
# Test directly
echo '{"session_id":"test","prompt":"edit a file"}' | node unified-hook.mjs prompt
```

**No API key?**
Set `OPENROUTER_API_KEY` or configure `cf-approve`

**Background enrichment not working?**
Check `config.json` → `rolling_log.backgroundEnrichment: true`

**Formatting not running?**
Verify tool is installed (prettier, black, etc.) and `formatting.enabled: true`
