# Fix R Data Science Skill and Agents Installation

## Scope

1. **Full agent conversion** - Convert documentation-style files to proper system prompts
2. **Global skill installation** - Install skill at `~/.claude/skills/` for all projects
3. **Global agents installation** - Install agents at `~/.claude/agents/` for all projects
4. **Create distribution package** - Package corrected files as a new zip for future use

## Problem Summary

The **r-data-science skill IS installed** but the **agents are NOT being recognized** by Claude Code's Task tool.

### Root Causes

1. **Wrong location**: Agent files are at `.claude/skills/r-data-science/agents/` but should be at `~/.claude/agents/`
2. **Missing YAML frontmatter**: Agent files are written as documentation, not as agent configurations
3. **Wrong format**: Agent files need to be system prompts, not documentation

### Current State
```
# Project-level (not working for agents)
/Users/aiml/Projects/Rdata/.claude/
├── settings.local.json
└── skills/
    └── r-data-science/
        ├── SKILL.md           (project-scoped)
        ├── README.md
        ├── CLAUDE_TEMPLATE.md
        └── agents/            ❌ Wrong location, wrong format
            ├── data-wrangler.md       (no frontmatter)
            ├── viz-builder.md         (no frontmatter)
            ├── stats-analyst.md       (no frontmatter)
            ├── report-generator.md    (no frontmatter)
            ├── dashboard-builder.md   (no frontmatter)
            └── data-storyteller.md    (no frontmatter)

# Global (working)
~/.claude/skills/
└── bdg/                       ✅ Working example
```

### Target State
```
# Global installation (available in all projects)
~/.claude/
├── skills/
│   ├── bdg/                   (existing)
│   └── r-data-science/        ✅ NEW: Global skill
│       └── SKILL.md
└── agents/                    ✅ NEW: Global agents directory
    ├── r-data-wrangler.md
    ├── r-viz-builder.md
    ├── r-stats-analyst.md
    ├── r-report-generator.md
    ├── r-dashboard-builder.md
    └── r-data-storyteller.md

# Distribution package
/Users/aiml/Projects/Rdata/r-data-science-claude-pkg/
├── README.md
├── skills/
│   └── r-data-science/
│       └── SKILL.md
└── agents/
    ├── r-data-wrangler.md
    ├── r-viz-builder.md
    ├── r-stats-analyst.md
    ├── r-report-generator.md
    ├── r-dashboard-builder.md
    └── r-data-storyteller.md
```

---

## Implementation Steps

### Step 1: Create global directories
```bash
mkdir -p ~/.claude/skills/r-data-science
mkdir -p ~/.claude/agents
```

### Step 2: Install skill globally

Copy the existing SKILL.md (which has correct format) to global location:
```bash
cp /Users/aiml/Projects/Rdata/.claude/skills/r-data-science/SKILL.md ~/.claude/skills/r-data-science/
```

### Step 3: Convert and install agents globally

Each agent file needs to be converted from documentation format to system prompt format with YAML frontmatter.

**Agent format template:**
```markdown
---
name: r-data-wrangler
description: "Clean, reshape, and prepare messy R datasets. Use for data cleaning, missing data handling, reshaping (wide/long), joining data sources, and creating derived variables."
---

You are an R data wrangling specialist. [System prompt instructions...]
```

**Agents to convert:**

| Source File | Target Name | Description |
|-------------|-------------|-------------|
| data-wrangler.md | r-data-wrangler | Data cleaning, reshaping, missing data handling |
| viz-builder.md | r-viz-builder | ggplot2 visualizations with modern design principles |
| stats-analyst.md | r-stats-analyst | Statistical analysis, epi calculations, modeling |
| report-generator.md | r-report-generator | Professional Quarto reports and documentation |
| dashboard-builder.md | r-dashboard-builder | Interactive Shiny and Quarto dashboards |
| data-storyteller.md | r-data-storyteller | Data communication and narrative building |

Note: Prefixing with `r-` to avoid name conflicts with other potential agents.

### Step 4: Create distribution package

Create a new clean package with corrected files:

```
/Users/aiml/Projects/Rdata/r-data-science-claude-pkg/
├── README.md                    # Installation instructions
├── install.sh                   # Quick install script
├── skills/
│   └── r-data-science/
│       └── SKILL.md
└── agents/
    ├── r-data-wrangler.md
    ├── r-viz-builder.md
    ├── r-stats-analyst.md
    ├── r-report-generator.md
    ├── r-dashboard-builder.md
    └── r-data-storyteller.md
```

### Step 5: Create zip package

```bash
cd /Users/aiml/Projects/Rdata
zip -r r-data-science-claude-pkg.zip r-data-science-claude-pkg/
```

### Step 6: Clean up project-level installation (optional)

Remove the now-redundant project-level skill:
```bash
rm -rf /Users/aiml/Projects/Rdata/.claude/skills/r-data-science
```

### Step 7: Verify installation

Restart Claude Code and verify:
- `r-data-science` appears in available skills (globally)
- All 6 agents appear in `/agents` command
- Agents are available as Task tool subagent_types

---

## Files to Create

### Global Installation

| Action | Path |
|--------|------|
| Copy | `~/.claude/skills/r-data-science/SKILL.md` |
| Create | `~/.claude/agents/r-data-wrangler.md` |
| Create | `~/.claude/agents/r-viz-builder.md` |
| Create | `~/.claude/agents/r-stats-analyst.md` |
| Create | `~/.claude/agents/r-report-generator.md` |
| Create | `~/.claude/agents/r-dashboard-builder.md` |
| Create | `~/.claude/agents/r-data-storyteller.md` |

### Distribution Package

| Action | Path |
|--------|------|
| Create | `/Users/aiml/Projects/Rdata/r-data-science-claude-pkg/README.md` |
| Create | `/Users/aiml/Projects/Rdata/r-data-science-claude-pkg/install.sh` |
| Create | `/Users/aiml/Projects/Rdata/r-data-science-claude-pkg/skills/r-data-science/SKILL.md` |
| Create | `/Users/aiml/Projects/Rdata/r-data-science-claude-pkg/agents/r-data-wrangler.md` |
| Create | `/Users/aiml/Projects/Rdata/r-data-science-claude-pkg/agents/r-viz-builder.md` |
| Create | `/Users/aiml/Projects/Rdata/r-data-science-claude-pkg/agents/r-stats-analyst.md` |
| Create | `/Users/aiml/Projects/Rdata/r-data-science-claude-pkg/agents/r-report-generator.md` |
| Create | `/Users/aiml/Projects/Rdata/r-data-science-claude-pkg/agents/r-dashboard-builder.md` |
| Create | `/Users/aiml/Projects/Rdata/r-data-science-claude-pkg/agents/r-data-storyteller.md` |

---

## Agent Conversion Details

Each agent will be converted from documentation format to a system prompt that tells Claude how to behave as that specialist. The key sections from each original file will be transformed:

- **Purpose** → System prompt introduction
- **Activation** → Kept in description for auto-matching
- **Instructions** → Converted to behavioral directives
- **Patterns/Templates** → Included as reference material
- **Checklists** → Included as quality verification steps

The agents will be autonomous specialists that can be invoked via the Task tool to handle specific R data science tasks.
