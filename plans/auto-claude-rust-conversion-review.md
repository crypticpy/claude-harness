# Implementation Plan: Full Feature Parity - Auto-Claude to Forge Rust

Created: 2025-12-19
Status: PENDING APPROVAL

## Summary

Convert Auto-Claude (Python/Electron) to Forge (Rust/Tauri) with full feature parity. The existing React frontend from `auto-claude-ui` will be reused with a new Tauri backend replacing Electron. This requires implementing ~15 new Rust modules covering the complete Auto-Claude feature set.

## Current State

### Already Built (Forge Rust Backend)
- 12 crates, 54,288 lines, 427 tests passing
- Core orchestration, agents, tools, persistence ✅

### Needs Implementation
- Git worktree isolation
- AI merge resolution (3-tier)
- Memory layer (Graphiti alternative or integration)
- Spec creation pipeline (8 phases)
- Security sandbox
- Tauri IPC bridge (180+ channels)
- CLI commands

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    auto-claude-ui (React Frontend)                       │
│                         (REUSED AS-IS)                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                              Tauri IPC
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                         forge-tauri (Extended)                           │
│  - IPC Handlers (180+ channels)                                          │
│  - Command Definitions                                                   │
│  - Event Streaming                                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
┌────────▼────────┐    ┌────────────▼────────────┐    ┌───────▼────────┐
│  forge-worktree │    │     forge-memory        │    │  forge-merge   │
│  (NEW)          │    │     (NEW)               │    │  (NEW)         │
│  - Worktree mgmt│    │  - Graph memory         │    │  - 3-tier merge│
│  - Branch ops   │    │  - File fallback        │    │  - AI resolver │
│  - Isolation    │    │  - Semantic search      │    │  - Timeline    │
└─────────────────┘    └─────────────────────────┘    └────────────────┘
         │                          │                          │
         └──────────────────────────┼──────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                         forge-spec (NEW)                                 │
│  - 8-phase spec pipeline                                                 │
│  - Requirements gathering                                                │
│  - Context discovery                                                     │
│  - Spec writing/validation                                               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                       forge-security (NEW)                               │
│  - Command validation                                                    │
│  - Filesystem restrictions                                               │
│  - Stack-aware allowlists                                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                    EXISTING FORGE CRATES                                 │
│  forge-agent, forge-orchestrator, forge-tools, forge-bus,               │
│  forge-persist, forge-store, forge-profiler, forge-lsp,                 │
│  forge-patterns, forge-config, forge-types                              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Scope

### In Scope
1. **New Crates** (6 new crates):
   - `forge-worktree` - Git worktree isolation
   - `forge-memory` - Cross-session memory (graph + file)
   - `forge-merge` - AI merge resolution
   - `forge-spec` - Spec creation pipeline
   - `forge-security` - Command sandbox
   - `forge-cli` - CLI binary

2. **Extended Crates**:
   - `forge-tauri` - Full IPC implementation (180+ handlers)
   - `forge-agent` - Spec agents (Planner, Coder, QA)
   - `forge-types` - New types for worktree, merge, spec

3. **Integration**:
   - Connect to existing `auto-claude-ui` React frontend
   - Replace Electron with Tauri
   - Python subprocess spawning (for Claude Code SDK)

### Out of Scope
- Rewriting the React frontend
- Linear/GitHub OAuth (use existing implementations via shell)
- Docker/FalkorDB management (shell commands)

---

## Implementation Phases

### Phase 1: Foundation Types & Security
**Objective**: Add core types and security layer

**New Crate: forge-security**
- `/Users/aiml/Projects/forge/forge-project/crates/forge-security/`

**Files to Create**:
- `Cargo.toml` - Dependencies: regex, serde, thiserror
- `src/lib.rs` - Module exports
- `src/validator.rs` - Command validation registry
- `src/profile.rs` - SecurityProfile (base + stack + custom commands)
- `src/parsers.rs` - Shell command parsing
- `src/validators/mod.rs` - Validator implementations
- `src/validators/process.rs` - pkill, kill, killall
- `src/validators/filesystem.rs` - chmod, rm, mv
- `src/validators/git.rs` - git commit validation
- `src/validators/database.rs` - dropdb, psql, redis-cli
- `src/error.rs` - SecurityError

**Types to Add to forge-types**:
```rust
pub struct SecurityProfile {
    pub base_commands: HashSet<String>,
    pub stack_commands: HashSet<String>,
    pub custom_commands: HashSet<String>,
}

pub enum ValidationResult {
    Allowed,
    Denied { reason: String },
    Modified { command: String, reason: String },
}
```

**Verification**:
- [ ] `cargo build -p forge-security` succeeds
- [ ] Command validation tests pass
- [ ] Integration with forge-tools

---

### Phase 2: Git Worktree Management
**Objective**: Isolated workspaces for parallel tasks

**New Crate: forge-worktree**
- `/Users/aiml/Projects/forge/forge-project/crates/forge-worktree/`

**Files to Create**:
- `Cargo.toml` - Dependencies: git2, tokio, serde
- `src/lib.rs` - Module exports and WorktreeManager
- `src/manager.rs` - WorktreeManager implementation
- `src/operations.rs` - create, remove, list, merge operations
- `src/branch.rs` - Branch detection and management
- `src/info.rs` - WorktreeInfo struct
- `src/error.rs` - WorktreeError

**Key Types**:
```rust
pub struct WorktreeManager {
    project_dir: PathBuf,
    base_branch: String,
    worktrees_dir: PathBuf,
}

pub struct WorktreeInfo {
    pub name: String,
    pub path: PathBuf,
    pub branch: String,
    pub spec_name: String,
    pub created_at: DateTime<Utc>,
}

impl WorktreeManager {
    pub fn new(project_dir: &Path) -> Result<Self>;
    pub async fn create_worktree(&self, spec_name: &str) -> Result<WorktreeInfo>;
    pub async fn get_or_create(&self, spec_name: &str) -> Result<WorktreeInfo>;
    pub async fn remove(&self, spec_name: &str, delete_branch: bool) -> Result<()>;
    pub async fn list_all(&self) -> Result<Vec<WorktreeInfo>>;
    pub async fn get_changed_files(&self, spec_name: &str) -> Result<Vec<FileChange>>;
    pub async fn merge_to_base(&self, spec_name: &str) -> Result<MergeResult>;
}
```

**Verification**:
- [ ] `cargo build -p forge-worktree` succeeds
- [ ] Worktree create/list/remove tests pass
- [ ] Integration with git repositories

---

### Phase 3: Memory System
**Objective**: Cross-session context retention

**New Crate: forge-memory**
- `/Users/aiml/Projects/forge/forge-project/crates/forge-memory/`

**Files to Create**:
- `Cargo.toml` - Dependencies: sled, serde, async-trait, tokio
- `src/lib.rs` - Module exports
- `src/store.rs` - MemoryStore trait and implementations
- `src/file_store.rs` - File-based memory (always available)
- `src/graph_store.rs` - Graph-based memory (optional, via HTTP to FalkorDB)
- `src/episodes.rs` - Episode types (session_insight, codebase_discovery, pattern, gotcha)
- `src/search.rs` - Memory search and retrieval
- `src/manager.rs` - MemoryManager (facade for both stores)
- `src/error.rs` - MemoryError

**Key Types**:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EpisodeType {
    SessionInsight,
    CodebaseDiscovery,
    Pattern,
    Gotcha,
    TaskOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Episode {
    pub id: String,
    pub episode_type: EpisodeType,
    pub content: String,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub spec_id: Option<String>,
    pub project_id: String,
}

#[async_trait]
pub trait MemoryStore: Send + Sync {
    async fn save_episode(&self, episode: Episode) -> Result<()>;
    async fn search(&self, query: &str, limit: usize) -> Result<Vec<Episode>>;
    async fn get_session_history(&self, spec_id: &str, limit: usize) -> Result<Vec<Episode>>;
    async fn get_by_type(&self, episode_type: EpisodeType, limit: usize) -> Result<Vec<Episode>>;
}

pub struct MemoryManager {
    file_store: FileMemoryStore,
    graph_store: Option<GraphMemoryStore>,
}
```

**Verification**:
- [ ] `cargo build -p forge-memory` succeeds
- [ ] File-based memory tests pass
- [ ] Episode save/search works

---

### Phase 4: AI Merge Resolution
**Objective**: 3-tier conflict resolution

**New Crate: forge-merge**
- `/Users/aiml/Projects/forge/forge-project/crates/forge-merge/`

**Files to Create**:
- `Cargo.toml` - Dependencies: git2, serde, async-trait, reqwest
- `src/lib.rs` - Module exports
- `src/types.rs` - ConflictRegion, MergeResult, ChangeType, etc.
- `src/detector.rs` - Conflict detection
- `src/auto_merger.rs` - Tier 1: Deterministic merge strategies
- `src/ai_resolver.rs` - Tier 2: AI-based resolution
- `src/orchestrator.rs` - MergeOrchestrator (coordinates all tiers)
- `src/timeline.rs` - FileTimelineTracker
- `src/semantic.rs` - Semantic change analysis
- `src/prompts.rs` - AI prompts for merge resolution
- `src/error.rs` - MergeError

**Key Types**:
```rust
#[derive(Debug, Clone)]
pub enum MergeStrategy {
    CombineImports,
    HooksFirst,
    AiRequired,
    HumanRequired,
}

#[derive(Debug, Clone)]
pub enum MergeDecision {
    AutoMerged,
    AiMerged { tokens_used: usize },
    NeedsHumanReview { reason: String },
    Failed { error: String },
}

#[derive(Debug, Clone)]
pub struct ConflictRegion {
    pub file_path: PathBuf,
    pub line_start: usize,
    pub line_end: usize,
    pub base_content: String,
    pub ours_content: String,
    pub theirs_content: String,
    pub severity: ConflictSeverity,
    pub strategy: MergeStrategy,
}

pub struct MergeOrchestrator {
    project_dir: PathBuf,
    ai_enabled: bool,
    timeline: FileTimelineTracker,
}

impl MergeOrchestrator {
    pub async fn merge_task(&self, task_id: &str, target_branch: &str) -> Result<MergeReport>;
    pub async fn preview_merge(&self, task_ids: &[String]) -> Result<MergePreview>;
}
```

**Verification**:
- [ ] `cargo build -p forge-merge` succeeds
- [ ] Auto-merge for simple conflicts works
- [ ] AI resolver integration (mock for tests)

---

### Phase 5: Spec Creation Pipeline
**Objective**: 8-phase spec workflow

**New Crate: forge-spec**
- `/Users/aiml/Projects/forge/forge-project/crates/forge-spec/`

**Files to Create**:
- `Cargo.toml`
- `src/lib.rs`
- `src/pipeline.rs` - SpecPipeline orchestrator
- `src/phases/mod.rs` - Phase trait and implementations
- `src/phases/discovery.rs` - Phase 1: Project analysis
- `src/phases/requirements.rs` - Phase 2: Requirements gathering
- `src/phases/context.rs` - Phase 3: Context discovery
- `src/phases/spec_writer.rs` - Phase 4: Spec document creation
- `src/phases/spec_critic.rs` - Phase 5: Self-critique
- `src/phases/planner.rs` - Phase 6: Implementation planning
- `src/phases/validation.rs` - Phase 7: Spec validation
- `src/models.rs` - Spec, Requirements, ImplementationPlan
- `src/prompts.rs` - Agent prompts
- `src/error.rs`

**Key Types**:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Spec {
    pub id: String,
    pub title: String,
    pub workflow_type: WorkflowType,
    pub requirements: Requirements,
    pub implementation_plan: Option<ImplementationPlan>,
    pub status: SpecStatus,
}

#[derive(Debug, Clone)]
pub enum WorkflowType {
    Feature,
    Refactor,
    Investigation,
    Migration,
    Simple,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImplementationPlan {
    pub phases: Vec<Phase>,
    pub subtasks: Vec<Subtask>,
    pub status: PlanStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subtask {
    pub id: String,
    pub phase: usize,
    pub title: String,
    pub files: Vec<PathBuf>,
    pub status: SubtaskStatus,
    pub dependencies: Vec<String>,
}

pub struct SpecPipeline {
    phases: Vec<Box<dyn SpecPhase>>,
}

impl SpecPipeline {
    pub async fn run(&self, initial_request: &str) -> Result<Spec>;
    pub async fn resume(&self, spec: &mut Spec) -> Result<()>;
}
```

**Verification**:
- [ ] `cargo build -p forge-spec` succeeds
- [ ] Pipeline phases execute in order
- [ ] Spec document generation works

---

### Phase 6: Tauri IPC Bridge
**Objective**: Connect React frontend to Rust backend

**Extended Crate: forge-tauri**
- Extend existing `/Users/aiml/Projects/forge/forge-project/crates/forge-tauri/`

**Files to Create/Modify**:
- `src/main.rs` - Tauri entry point with all commands
- `src/ipc/mod.rs` - IPC module organization
- `src/ipc/project.rs` - Project handlers (7 channels)
- `src/ipc/task.rs` - Task handlers (15 channels)
- `src/ipc/terminal.rs` - Terminal handlers (18 channels)
- `src/ipc/settings.rs` - Settings handlers
- `src/ipc/roadmap.rs` - Roadmap handlers
- `src/ipc/ideation.rs` - Ideation handlers
- `src/ipc/insights.rs` - Insights handlers
- `src/ipc/changelog.rs` - Changelog handlers
- `src/ipc/context.rs` - Context/memory handlers
- `src/ipc/github.rs` - GitHub handlers
- `src/ipc/docker.rs` - Docker/FalkorDB handlers
- `src/ipc/worktree.rs` - Worktree handlers
- `src/terminal/mod.rs` - PTY management
- `src/terminal/session.rs` - Terminal session management
- `src/process.rs` - Python subprocess spawning

**IPC Channels to Implement** (180+ total, key ones):
```rust
// Project
#[tauri::command] async fn project_add(...) -> Result<Project>;
#[tauri::command] async fn project_remove(...) -> Result<()>;
#[tauri::command] async fn project_list(...) -> Result<Vec<Project>>;

// Task
#[tauri::command] async fn task_create(...) -> Result<Task>;
#[tauri::command] async fn task_start(...) -> Result<()>;
#[tauri::command] async fn task_stop(...) -> Result<()>;
#[tauri::command] async fn task_review(...) -> Result<TaskReview>;

// Worktree
#[tauri::command] async fn worktree_status(...) -> Result<WorktreeStatus>;
#[tauri::command] async fn worktree_merge(...) -> Result<MergeReport>;
#[tauri::command] async fn worktree_diff(...) -> Result<Vec<FileDiff>>;

// Terminal
#[tauri::command] async fn terminal_create(...) -> Result<TerminalId>;
#[tauri::command] async fn terminal_input(...) -> Result<()>;
#[tauri::command] async fn terminal_invoke_claude(...) -> Result<()>;

// Events (emitted to frontend)
app.emit_all("task:progress", progress)?;
app.emit_all("terminal:output", output)?;
app.emit_all("roadmap:complete", roadmap)?;
```

**Verification**:
- [ ] Tauri app compiles and runs
- [ ] IPC handlers respond correctly
- [ ] Events stream to frontend

---

### Phase 7: CLI Binary
**Objective**: Command-line interface for headless operation

**New Crate: forge-cli**
- `/Users/aiml/Projects/forge/forge-project/crates/forge-cli/`

**Files to Create**:
- `Cargo.toml`
- `src/main.rs` - CLI entry point
- `src/commands/mod.rs`
- `src/commands/init.rs` - Project initialization
- `src/commands/build.rs` - Start build (spec + implement)
- `src/commands/spec.rs` - Spec management
- `src/commands/qa.rs` - QA commands
- `src/commands/merge.rs` - Merge worktrees
- `src/commands/status.rs` - Project/task status

**CLI Structure**:
```
forge init [--force]
forge build --spec <id> [--dry-run]
forge spec list
forge spec create <description>
forge qa run --spec <id>
forge merge --spec <id> [--preview]
forge status [--detailed]
```

**Verification**:
- [ ] `cargo build -p forge-cli` succeeds
- [ ] CLI commands work end-to-end
- [ ] Integration with all crates

---

### Phase 8: Integration & Testing
**Objective**: End-to-end system integration

**Steps**:
1. Update workspace Cargo.toml with new crates
2. Wire up all crate dependencies
3. Integration tests across crate boundaries
4. Connect Tauri to auto-claude-ui
5. End-to-end testing with real projects

**Verification**:
- [ ] `cargo build --release` succeeds
- [ ] `cargo test` all tests pass
- [ ] Desktop app launches and functions
- [ ] CLI commands work

---

## New Crate Dependency Graph

```
Layer 0: forge-types (extended)
         ↓
Layer 1: forge-security, forge-worktree, forge-memory
         ↓
Layer 2: forge-merge (depends on worktree, memory)
         ↓
Layer 3: forge-spec (depends on memory, agent)
         ↓
Layer 4: forge-tauri (extended - depends on all)
         forge-cli (depends on all)
```

## Updated Workspace Members

```toml
[workspace]
members = [
    # Layer 0 (existing)
    "crates/forge-types",
    "crates/forge-config",
    "crates/forge-patterns",
    # Layer 1 (existing + new)
    "crates/forge-store",
    "crates/forge-lsp",
    "crates/forge-profiler",
    "crates/forge-security",      # NEW
    "crates/forge-worktree",      # NEW
    "crates/forge-memory",        # NEW
    # Layer 2 (existing + new)
    "crates/forge-tools",
    "crates/forge-bus",
    "crates/forge-merge",         # NEW
    # Layer 3 (existing + new)
    "crates/forge-agent",
    "crates/forge-orchestrator",
    "crates/forge-spec",          # NEW
    # Layer 4 (existing + new)
    "crates/forge-persist",
    "crates/forge-tauri",         # EXTENDED
    "crates/forge-cli",           # NEW
]
```

---

## Testing Strategy

- Unit tests in each crate (inline `#[cfg(test)]`)
- Integration tests for cross-crate workflows
- E2E tests with mock Claude responses
- Manual testing with auto-claude-ui

---

## Rollback Plan

Each phase is independent. If a phase fails:
1. Revert the specific crate changes
2. Previous phases remain functional
3. Existing Forge backend continues to work

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Tauri/Electron IPC incompatibility | Medium | High | Map all 180+ channels before implementing |
| FalkorDB Rust client missing | Medium | Medium | Use HTTP API or file-only mode |
| Claude Code SDK only in Python | High | High | Spawn Python subprocess, communicate via JSON |
| Complex merge resolution edge cases | Medium | Medium | Start with deterministic merges, AI as fallback |

---

## Open Questions

1. **FalkorDB integration**: Use HTTP client to existing FalkorDB, or implement graph in sled?
   - Recommendation: HTTP client first, allows reusing existing Docker setup

2. **Claude Code SDK**: Keep spawning Python, or port SDK to Rust?
   - Recommendation: Spawn Python, SDK is complex and maintained by Anthropic

3. **Terminal management**: Use portable-pty crate or shell out?
   - Recommendation: portable-pty for native performance

---

## Estimated Effort

| Phase | Crate(s) | Complexity |
|-------|----------|------------|
| 1 | forge-security | Medium |
| 2 | forge-worktree | Medium |
| 3 | forge-memory | High |
| 4 | forge-merge | High |
| 5 | forge-spec | High |
| 6 | forge-tauri (IPC) | Very High |
| 7 | forge-cli | Medium |
| 8 | Integration | High |

---

**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed with implementation.**
