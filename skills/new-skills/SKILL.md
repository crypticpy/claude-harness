---
name: new-skills
description: "Guide for creating Claude Code skills with proper folder structure and YAML configuration"
---

# Creating New Skills Guide

## Quick Reference: Skill Creation Steps

### 1. Create Skill Directory

```bash
# Project skill (team-wide)
mkdir -p .claude/skills/skill-name/

# Personal skill (project-specific)
mkdir -p ~/.claude/skills/skill-name/
```

### 2. Create SKILL.md File

Every skill requires a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: skill-name
description: What the skill does and when Claude should use it
allowed-tools: [optional tool restrictions]
---

# Skill Name

## Instructions
[Step-by-step guidance for Claude]

## Usage Patterns
[When and how to use this skill]

## Examples
[Concrete examples of skill application]
```

### 3. Required YAML Fields

**name** (required)
- Kebab-case naming (lowercase with hyphens)
- Example: `git-commits`, `create-component`, `debug-performance`

**description** (required, CRITICAL)
- **Include both functionality AND trigger terms**
- Claude uses this to determine when to invoke the skill
- Be specific about use cases
- Include terms users would mention
- Example: "Git protocol with intelligent commit orchestration. Use when committing code, creating commits, or finishing sessions."

**allowed-tools** (optional)
- Restricts available tools when skill is active
- Useful for read-only skills or security-sensitive operations
- Example: `allowed-tools: Read, Grep, Glob`

## Skill Directory Structure

```
.claude/skills/
└── skill-name/
    ├── SKILL.md              # Required main skill file
    ├── examples/             # Optional supporting files
    │   └── example.md
    ├── templates/            # Optional templates
    │   └── template.tsx
    └── reference/            # Optional reference docs
        └── api-docs.md
```

## Writing Effective Descriptions

### ❌ Bad Description
```yaml
description: Handles git operations
```

**Problem**: Too vague, no trigger terms, unclear when to use

### ✅ Good Description
```yaml
description: Git protocol with intelligent commit orchestration. Use when user requests to commit changes, create commits, finish work sessions, or when TodoWrite tasks are complete. Handles automatic commit message generation and staging.
```

**Why it works**:
- Clear functionality
- Specific trigger terms (commit, finish, complete)
- Explains when to activate

## Skill Types & Examples

### Workflow Skills
Automate common development workflows

```yaml
---
name: component-generator
description: Creates React components with TypeScript, tests, and stories. Use when user asks to create component, generate component, or scaffold new component.
---
```

### Reference Skills
Provide quick access to documentation

```yaml
---
name: api-reference
description: Quick reference for internal API patterns and authentication. Use when user asks about API structure, authentication patterns, or needs API examples.
allowed-tools: Read, Grep
---
```

### Protocol Skills
Enforce development standards

```yaml
---
name: code-review
description: Automated code review checklist for TypeScript and React. Use before commits, when user requests review, or when validating code quality.
---
```

## Best Practices

### 1. Keep Skills Focused
- One skill = one capability
- Avoid combining unrelated functionality
- Split complex workflows into multiple coordinated skills

### 2. Use Clear Trigger Language
- Include synonyms users might say
- Think about natural language requests
- Test with team members

### 3. Provide Context and Examples
- Show concrete usage patterns
- Include code examples when relevant
- Document edge cases

### 4. Leverage Supporting Files
- Keep SKILL.md concise
- Move large references to separate files
- Organize by topic in subdirectories

### 5. Version Your Skills
- Document changes in skill content
- Track updates to instructions
- Note breaking changes

## Tool Restrictions

Restrict tools for security or clarity:

### Read-Only Research Skill
```yaml
---
name: codebase-analyzer
description: Analyzes codebase patterns without modifications
allowed-tools: Read, Grep, Glob, Bash
---
```

### Write-Only Generation Skill
```yaml
---
name: file-generator
description: Generates files from templates
allowed-tools: Write, Read
---
```

## Activation & Invocation

Skills are **model-invoked** (automatic), not user-invoked like slash commands:

- Claude reads all skill descriptions
- Matches user request to skill descriptions
- Activates relevant skill autonomously
- User can reference skills: "Use the git-commits skill"

## Common Mistakes

### 1. Vague Descriptions
❌ `description: Helps with React`
✅ `description: Creates React components with hooks and TypeScript. Use when building components, adding features, or scaffolding UI.`

### 2. Invalid YAML Syntax
❌ Missing closing quotes
❌ Incorrect indentation
✅ Validate with YAML linter

### 3. Missing Trigger Terms
❌ Only describes what it does
✅ Includes when to use and trigger keywords

### 4. Conflicting Skills
❌ Multiple skills with similar descriptions
✅ Distinct descriptions with unique trigger terms

## Testing Your Skill

After creating a skill:

1. **Syntax Check**: Ensure YAML is valid
2. **Description Test**: Ask Claude about the skill domain
3. **Activation Test**: Make requests using trigger terms
4. **Team Feedback**: Have others test natural requests

## Troubleshooting

**Skill not activating?**
- Add more trigger terms to description
- Make description more specific
- Check YAML syntax

**Wrong skill activating?**
- Make descriptions more distinct
- Use unique trigger terminology
- Narrow skill scope

**Skill errors?**
- Verify file paths use forward slashes
- Check YAML frontmatter syntax
- Ensure SKILL.md exists in folder

## Quick Checklist

- [ ] Created `.claude/skills/skill-name/` directory
- [ ] Created `SKILL.md` file inside directory
- [ ] Added YAML frontmatter with `name` and `description`
- [ ] Description includes trigger terms and use cases
- [ ] Skill content has clear instructions
- [ ] Tested activation with natural language requests
- [ ] Added to project or personal skills as appropriate

---

**Use this skill when**: User asks to create a skill, wants to understand skill configuration, or needs help with skill development.
