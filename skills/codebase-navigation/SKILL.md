---
name: codebase-navigation
description: Codebase structure and efficient navigation tips
---
# Directory Structure

## 🏗️ Claude Fast Framework Organization

```
.claude/
├── agents/                                     # Sub-agent configurations (17 specialists)
│   ├── # FORGE PROJECT (Priority)
│   ├── forge-rust-backend.md                   # Rust crates, event bus, agent orchestration, SQLite
│   ├── forge-frontend-architect.md             # Tauri UI, commands, theming, frontend-backend integration
│   ├── # ORCHESTRATION
│   ├── master-orchestrator.md                  # Strategic coordination, session planning
│   ├── # DEVELOPMENT
│   ├── backend-engineer.md                     # Server actions, APIs, database operations
│   ├── fullstack-architect.md                  # Cross-stack integration, Next.js, Python/FastAPI
│   ├── frontend-ux-debugger.md                 # UI/UX issues, visual inconsistencies, fixes
│   ├── python-maestro.md                       # Elegant Python code, Pythonic patterns
│   ├── # QUALITY & PERFORMANCE
│   ├── quality-engineer.md                     # Testing, QA automation, pattern validation
│   ├── principal-code-reviewer.md              # Expert code review against standards
│   ├── final-review-completeness.md            # Post-implementation completeness audit
│   ├── performance-optimizer.md                # Core Web Vitals, optimization strategies
│   ├── web-performance-architect.md            # Real-time rendering, Web Audio, DSP
│   ├── # RESEARCH & DEBUGGING
│   ├── debugger-detective.md                   # Bug investigation, root cause analysis
│   ├── deep-researcher.md                      # External research, evidence-based decisions
│   ├── # SPECIALIZED
│   ├── ml-architect.md                         # ML models, pipelines, AI integrations
│   ├── docker-macos-specialist.md              # Docker containers, cross-platform deployment
│   └── ui-tester.md                            # Browser automation, form testing, user flows
│
├── context/                                    # Development patterns and examples
│   └── rules+examples/                         # Development patterns and code examples (28 files)
│       ├── ai-sdk-patterns.md                  # AI SDK integration patterns
│       ├── anthropic-claudecode-outputstyle.md # Claude Code output style guidelines
│       ├── api-auth-patterns.md                # API routes, authentication, security
│       ├── archived-turbostarter-hero-components.md # Archived component patterns
│       ├── blog-navigation-patterns.md         # Blog navigation implementation
│       ├── blog-patterns.md                    # Blog content patterns and MDX
│       ├── claude-code-boost-addon.md          # Claude enhancements and optimizations
│       ├── component-examples.md               # UI component implementation examples
│       ├── context7-mcp-patterns.md            # Context7 MCP integration patterns
│       ├── database-examples.md                # Database query and schema examples
│       ├── docker-deployment-patterns.md       # Docker deployment configurations
│       ├── email-content-patterns.md           # Email development and content workflows
│       ├── formatting-ci-cd-patterns.md        # CI/CD and formatting standards
│       ├── forms-state-patterns.md             # Forms, validation, state management
│       ├── nextbase-reference.md               # Starter kit reference patterns
│       ├── nextjs-react-patterns.md            # React and Next.js best practices
│       ├── performance-testing-patterns.md     # Testing, E2E, performance optimization
│       ├── playwright-mcp-patterns.md          # Playwright testing workflows
│       ├── project-organization-patterns.md    # Project structure and organization
│       ├── server-action-examples.md           # Server action implementation patterns
│       ├── shadcn-mcp-patterns.md              # Shadcn UI component patterns
│       ├── sitemap-best-practices.md           # Sitemap generation and SEO
│       ├── subagent-readme.md                  # Sub-agent architecture documentation
│       ├── supabase-database-patterns.md       # Database, RLS, migrations, queries
│       ├── tanstack-table-patterns.md          # Advanced data tables, filtering
│       ├── typescript-patterns.md              # TypeScript advanced patterns, types
│       └── ui-styling-patterns.md              # UI styling and component patterns
│
└── tasks/                                      # Session-based task management
│   ├── session-template.md                     # Session file template
│   ├── session-001.md                          # Completed session (example)
│   ├── session-002.md                          # Completed session (example)
│   └── session-current.md                      # Active session (if any)
│
└── skills/                                     # Lazy-loaded skills
│   ├── git-commits/
│   ├── session-management/
│   ├── sub-agent-invocation/
│   └── codebase-navigation/                    # This skill
```

## 📁 Root Configuration

```
/CLAUDE.md                   # Central AI configuration - auto-loaded base
```

## 📋 Session File Management

Session files serve as the single source of truth for development work:

- **session-template.md**: Template for creating new sessions
- **session-current.md**: Active session with ongoing work
- **session-[number].md**: Archived completed sessions

Each session file contains:
- User request and success criteria
- Task breakdown with TodoWrite synchronization
- Agent work sections and progress updates
- Research findings and architectural decisions
- Quality gates and validation checkpoints

## 🎯 Agent Specializations

### Forge Project (Priority)
- **forge-rust-backend**: Rust crates, event bus, agent orchestration, SQLite/Prisma
- **forge-frontend-architect**: Tauri UI, commands, theming, frontend-backend integration

### Core Development
- **backend-engineer**: APIs, server actions, middleware, auth
- **fullstack-architect**: Cross-stack integration, Next.js, Python/FastAPI
- **frontend-ux-debugger**: UI/UX issues, visual inconsistencies
- **python-maestro**: Elegant Python code, Pythonic patterns

### Quality & Performance
- **quality-engineer**: Testing strategies, QA automation, pattern validation
- **principal-code-reviewer**: Expert code review against standards
- **final-review-completeness**: Post-implementation completeness audit
- **performance-optimizer**: Optimization, Core Web Vitals
- **web-performance-architect**: Real-time rendering, Web Audio, DSP

### Research & Debugging
- **debugger-detective**: Root cause analysis, systematic debugging
- **deep-researcher**: External research, documentation analysis

### Specialized
- **ml-architect**: ML models, pipelines, AI integrations
- **docker-macos-specialist**: Docker containers, cross-platform deployment
- **ui-tester**: Browser automation, form testing, user flows

### Orchestration
- **master-orchestrator**: Session planning and strategic analysis

---

This structure supports the session-based workflow where all task and development management happens through session files in `.claude/tasks/`.
