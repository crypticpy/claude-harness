---
name: documentation-research
description: "Fetch up-to-date library documentation using Context7 API. Use when user needs current docs, API references, how to use a library, or mentions Context7."
---

# Documentation Research

**IMPORTANT: ALWAYS execute this skill through a sub-agent to preserve context window. NEVER run Context7 scripts directly in the main conversation.**

## Sub-Agent Execution (REQUIRED)

Spawn a sub-agent to fetch and condense docs:

```
Task tool:
  subagent_type: general-purpose
  model: haiku

Prompt:
---
You are a documentation research agent. Fetch docs and return ONLY relevant, condensed info.

**Query**: [USER'S QUESTION]

**Steps**:
1. Read "C:/Github/Claude-Fast/.claude/skills/documentation-research/SKILL.md" for scripts and error prevention
2. Execute resolve_library.py for "[library]"
3. Execute get_docs.py with --topic "[topic]" --tokens 3000

**Return**: Key steps, essential code, critical notes.
Do NOT return raw docs. Synthesize for the query.
---
```

## Scripts

### 1. Resolve Library ID
```bash
uv run context7-scripts/resolve_library.py "library name"
```

### 2. Fetch Documentation
```bash
uv run context7-scripts/get_docs.py "/org/library"
uv run context7-scripts/get_docs.py "/org/library" --topic "feature"
uv run context7-scripts/get_docs.py "/org/library" --tokens 10000
```

## Common IDs

| Library | ID |
|---------|-----|
| Next.js | /vercel/next.js |
| React | /facebook/react |
| Supabase | /supabase/supabase |
| Prisma | /prisma/prisma |
| Polar | /polarsource/polar |

## Error Prevention

**Windows paths**: Always use forward slashes, even on Windows:
```bash
# Correct
uv run "C:/Github/project/.claude/skills/documentation-research/context7-scripts/get_docs.py" "/org/lib"

# Wrong - backslashes fail in bash
uv run "C:\Github\project\..." "/org/lib"
```

**Git Bash path conversion**: The scripts auto-fix Git Bash converting `/org/lib` to `C:/Program Files/Git/org/lib`.
