# ClaudeFast Hooks Guide

ClaudeFast uses two hooks to create an intelligent, friction-free development experience:

1. **Skill Activation Hook** - Guarantees Claude Code loads the correct skills at the correct time. When you submit a prompt, this hook analyzes it and appends skill recommendations directly to your message before Claude sees it. Claude then knows exactly which skills to load—no extra analysis, no thinking overhead, no forgotten context.

2. **Permission Hook** - Allows Claude Code to run uninterrupted but safely, without sandbox mode or `--dangerously-skip-permissions`. It auto-approves safe operations, blocks destructive ones, and uses a cheap LLM for edge cases. Without it, you're constantly clicking approve buttons, breaking your flow.

The result: You type naturally, Claude works efficiently, and the framework handles orchestration behind the scenes.

---

## Skill Activation Hook

### What It Does

Every time you submit a prompt, this hook intercepts it, analyzes the content, and suggests relevant skills based on keyword and intent matching. The suggestions appear before Claude sees your message, so Claude knows to load the skills first.

```
You type: "help me implement a feature"
                    ↓
Hook analyzes: finds "implement", "feature"
                    ↓
Claude sees your prompt PLUS:

🎯 SKILL ACTIVATION CHECK

⚠️  CRITICAL SKILLS (REQUIRED):
  → session-management

📚 RECOMMENDED SKILLS:
  → git-commits

ACTION: Use Skill tool BEFORE responding
```

### Why It Matters

ClaudeFast has 14+ skills covering everything from session management to infrastructure operations. No one can remember all the keywords that should trigger each skill. This hook handles that automatically—your speech patterns trigger the right skills without you thinking about it.

### How Matching Works

The hook uses two matching strategies:

**Keyword Matching** - Simple, case-insensitive string matching. If your prompt contains "commit" or "git push", the `git-commits` skill triggers.

**Intent Patterns** - Regex patterns for more sophisticated matching. A pattern like `(implement|build).*?feature` catches variations like "let's implement this feature" or "build a new feature for me".

### Priority System

Not all skills are equally urgent. The hook groups suggestions by priority:

- **Critical** (⚠️) - Must be loaded. Example: `session-management` for multi-step implementations
- **High** (📚) - Strongly recommended. Example: `git-commits` when committing
- **Medium** (💡) - Helpful context. Example: `claudefast` when discussing the framework
- **Low** (📌) - Optional enhancement

### Session Intelligence

The hook tracks what it's already recommended in the current conversation session. If it suggested `payment-processing` earlier, it won't repeat the suggestion—reducing noise while ensuring nothing is missed.

### Configuration

All skill triggers are defined in `.claude/skills/skill-rules.json`:

```json
{
  "skills": {
    "session-management": {
      "type": "domain",
      "enforcement": "suggest",
      "priority": "critical",
      "description": "Complete session-based workflow",
      "promptTriggers": {
        "keywords": ["feature", "implement", "build", "refactor"],
        "intentPatterns": ["(implement|build).*?feature"]
      }
    }
  }
}
```

To add a new skill trigger, add an entry with keywords that match how you naturally talk about that domain.
After creating a new skill ask Claude to analyze and update the skill-rules.json.
Then read the new skill's triggers and keep those speech patterns in mind.

---

## Permission Hook

### What It Does

Claude Code normally asks permission before reading files, running commands, or making changes. This creates constant interruptions. The Permission Hook intercepts these requests and makes intelligent decisions:

- **Instantly approve** safe operations (reading files, writing code)
- **Instantly block** dangerous operations (deleting system files, force pushing to main)
- **Carefully analyze** ambiguous operations using a fast, cheap LLM

### Why This Approach

**Sandbox mode** limits what Claude can do. No shell access, restricted file operations.

**`--dangerously-skip-permissions`** removes all safety. Everything gets approved, including destructive commands.

**Permission Hook** gives you both: full capability with intelligent safety. Claude runs uninterrupted, but catastrophic commands get blocked automatically.

### Installation Options

You can configure the Permission Hook at two levels:

**Device Level** - Configure once in `~/.claude/settings.json`, applies to all projects. This is the author's preference—set it up once and forget about it.

**Project Level** - Configure in `.claude/settings.local.json` for project-specific rules. Useful if different projects need different approval patterns.

Both work identically. Choose based on your workflow preference.

### Quick Setup

```bash
# Install the package globally
npm install -g @abdo-el-mobayad/claude-code-fast-permission-hook

# Run the installer (adds hook to your settings)
cf-approve install

# Configure your API key
cf-approve config
```

The installer will ask where to add the hook (device or project level) and guide you through API configuration.

### The Three-Tier Decision System

**Tier 1: Fast Approve (No LLM)**

These operations are always safe:

- Read, Glob, Grep, WebFetch, WebSearch
- Write, Edit, MultiEdit, NotebookEdit
- TodoWrite, Task, AskUserQuestion
- All MCP tools (`mcp__*`)

**Tier 2: Fast Deny (No LLM)**

These operations are always blocked:

- `rm -rf /`, `rm -rf ~` - System destruction
- `git push --force origin main` - Protected branch overwrites
- `mkfs`, `fdisk` - Disk formatting
- Fork bombs, credential theft patterns

**Tier 3: LLM Analysis (Cached)**

Everything else gets analyzed by a fast, cheap LLM (GPT-4o-mini via OpenRouter). The decision is cached, so repeated operations don't incur additional cost or latency.

### Cost

Using GPT-4o-mini via OpenRouter: **$1 USD ≈ 5,000+ LLM decisions**

In practice, most operations hit Tier 1 or Tier 2 (no LLM needed), and Tier 3 decisions are cached. A dollar can easily last months of heavy use.

### Configuration

The hook stores its config at `~/.claude-code-fast-permission-hook/config.json`:

```json
{
  "llm": {
    "provider": "openai",
    "model": "openai/gpt-4o-mini",
    "apiKey": "sk-or-v1-your-key",
    "baseUrl": "https://openrouter.ai/api/v1"
  },
  "cache": {
    "enabled": true,
    "ttlHours": 168
  }
}
```

OpenRouter is recommended for best latency. You can also use OpenAI or Anthropic APIs directly.

### CLI Commands

```bash
cf-approve install        # Add hook to settings
cf-approve uninstall      # Remove hook
cf-approve config         # Interactive configuration
cf-approve doctor         # Diagnose setup issues
cf-approve status         # Show current configuration
cf-approve clear-cache    # Clear cached decisions
```

---

## Setup Summary

### Skill Activation Hook

Already configured in ClaudeFast. Just ensure your `.claude/settings.local.json` includes:

**Windows:**

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cmd /c \".claude\\hooks\\SkillActivationHook\\skill-activation-prompt.cmd\""
          }
        ]
      }
    ]
  }
}
```

**Linux/Mac/WSL:**

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/SkillActivationHook/skill-activation-prompt.sh"
          }
        ]
      }
    ]
  }
}
```

### Permission Hook

```bash
npm install -g @abdo-el-mobayad/claude-code-fast-permission-hook
cf-approve install
cf-approve config
```

The installer adds this to your `settings.json` (device or project level):

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "cf-approve permission"
          }
        ]
      }
    ]
  }
}
```

---

## Architecture

### Files

```
.claude/hooks/SkillActivationHook/
├── skill-activation-prompt.mjs   # Core logic (pure JS, cross-platform)
├── skill-activation-prompt.cmd   # Windows wrapper
├── skill-activation-prompt.sh    # Linux/Mac/WSL wrapper
├── recommendation-log.json       # Session state tracking
└── ClaudeFastHooksGuide.md       # This guide

.claude/skills/
└── skill-rules.json              # Skill trigger definitions
```

### Design Philosophy

Both hooks follow the same principles:

1. **Zero external dependencies** - No npm packages to install for the Skill Activation Hook. It uses pure Node.js built-ins.

2. **Cross-platform** - Same logic, platform-specific thin wrappers. Works on Windows, Mac, Linux, WSL.

3. **Portable** - Copy the `.claude` folder to any project and it works immediately.

4. **Intelligent caching** - Both hooks cache decisions to minimize overhead.

---

## Troubleshooting

### Skill Activation Hook Not Working

**Verify configuration:**

```bash
# Windows
type .claude\settings.local.json | findstr UserPromptSubmit

# Linux/Mac
grep -A 10 "UserPromptSubmit" .claude/settings.local.json
```

**Test directly:**

```bash
# Windows
echo '{"session_id":"test","prompt":"implement a feature"}' | cmd /c ".claude\hooks\SkillActivationHook\skill-activation-prompt.cmd"

# Linux/Mac
chmod +x .claude/hooks/SkillActivationHook/*.sh
echo '{"session_id":"test","prompt":"implement a feature"}' | bash .claude/hooks/SkillActivationHook/skill-activation-prompt.sh
```

### Permission Hook Issues

```bash
cf-approve doctor         # Full diagnostic
cf-approve status         # Check configuration
cf-approve clear-cache    # Reset if behaving strangely
```

### Common Errors

| Error                    | Cause                             | Fix                                |
| ------------------------ | --------------------------------- | ---------------------------------- |
| `.claude` not recognized | Missing `cmd /c` prefix (Windows) | Use `cmd /c ".claude\\hooks\\..."` |
| Duplicate suggestions    | Hook in both settings.json files  | Keep in one file only              |
| No suggestions appearing | No keyword matches                | Check skill-rules.json             |
| Permission denied        | API key issue                     | Run `cf-approve config`            |

---

## Platform Support

| Platform             | Skill Activation  | Permission Hook |
| -------------------- | ----------------- | --------------- |
| Windows (PowerShell) | ✅ `.cmd` wrapper | ✅ npm package  |
| Linux/Mac            | ✅ `.sh` wrapper  | ✅ npm package  |
| WSL                  | ✅ `.sh` wrapper  | ✅ npm package  |

---

_ClaudeFast v4.5 Hooks System_
