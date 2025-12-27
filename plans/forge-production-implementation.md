# Implementation Plan: Forge Full Production Implementation

Created: 2025-12-20
Status: APPROVED - EXECUTING ALL PHASES
Approved: 2025-12-20 by User
Execution Mode: Autonomous with parallel sub-agents through all 5 waves

## Summary

Complete production implementation of the Forge Tauri application, replacing all placeholder/stub implementations with real functionality. This covers 4 major domains: (1) AI integration for roadmap/ideation/insights generation via forge-orchestrator, (2) data persistence for all generated content using the existing Sled-based persistence layer, (3) Claude CLI integration for terminal-based AI interactions, and (4) GitHub/Linear external API implementations.

## Scope

### In Scope
- **AI Integration**: Real AI calls for `roadmap_generate`, `ideation_generate`, `insights_generate`, `changelog_generate`, `insights_send_message` (chat)
- **Data Persistence**: Persistent storage for roadmaps, ideation sessions, insights, changelogs using forge-persist patterns
- **Claude CLI**: Terminal-based Claude invocation (`terminal_invoke_claude`, `terminal_resume_claude`) and session management
- **GitHub API**: Complete OAuth token exchange, repository/issue/PR API calls via reqwest
- **Linear API**: OAuth token exchange and GraphQL API integration for teams/projects/issues
- **Terminal Sessions**: Session persistence, restore, and buffer saving

### Out of Scope
- Frontend UI changes (only backend handlers)
- New Tauri commands (only implementing existing stubs)
- Breaking API changes (maintain frontend contract)
- Electron migration (Tauri-only)

## Prerequisites

- [ ] Rust 1.75+ installed
- [ ] `cargo build` passes for all crates
- [ ] Claude API key or OAuth token available for testing
- [ ] GitHub OAuth app configured for testing
- [ ] Linear OAuth app configured for testing
- [ ] Sled database accessible at `.forge/` paths

---

## Implementation Phases

### Phase 1: AI Service Abstraction Layer

**Objective**: Create a unified AI service trait that all handlers can use, following the pattern from `forge-merge/src/ai_resolver.rs`.

**Files to Create**:
- `crates/forge-tauri/src/ai/mod.rs` - Module root
- `crates/forge-tauri/src/ai/service.rs` - AI service trait and implementations
- `crates/forge-tauri/src/ai/prompts.rs` - System/user prompts for each feature
- `crates/forge-tauri/src/ai/config.rs` - Model configuration and API key management

**Files to Modify**:
- `crates/forge-tauri/src/lib.rs` - Add `pub mod ai;`
- `crates/forge-tauri/src/state.rs` - Add `ai_service: Arc<dyn AiService>` to AppState
- `crates/forge-tauri/Cargo.toml` - Add `reqwest`, `async-trait` dependencies

**Steps**:

1. Create `AiService` trait:
```rust
#[async_trait]
pub trait AiService: Send + Sync {
    async fn generate_roadmap(&self, request: RoadmapPrompt) -> Result<RoadmapResponse>;
    async fn generate_ideas(&self, request: IdeationPrompt) -> Result<Vec<IdeaResponse>>;
    async fn generate_insights(&self, request: InsightsPrompt) -> Result<Vec<InsightResponse>>;
    async fn generate_changelog(&self, request: ChangelogPrompt) -> Result<ChangelogResponse>;
    async fn chat(&self, messages: Vec<ChatMessage>, config: ChatConfig) -> Result<ChatResponse>;
}
```

2. Create `ClaudeAiService` implementation:
   - Use reqwest for Anthropic API calls
   - Support claude-3-opus, claude-3-sonnet, claude-3-haiku models
   - Implement streaming for chat responses
   - Token estimation using ~4 chars/token rule

3. Create `MockAiService` for testing:
   - Return deterministic responses for unit tests
   - Track call counts and parameters

4. Create prompt templates:
   - Roadmap generation: analyze project, create phased plan
   - Ideation: code improvements, security, performance opportunities
   - Insights: codebase analysis, architectural issues, patterns
   - Changelog: summarize commits into release notes

**Verification**:
- [ ] `cargo build -p forge-tauri` compiles
- [ ] Unit tests for MockAiService pass
- [ ] Integration test with real Claude API succeeds

---

### Phase 2: Persistence Layer for Generated Content

**Objective**: Extend forge-persist patterns to store roadmaps, ideation, insights, and changelogs.

**Files to Create**:
- `crates/forge-persist/src/content.rs` - Content store for generated data
- `crates/forge-persist/src/roadmap_store.rs` - Roadmap-specific storage
- `crates/forge-persist/src/ideation_store.rs` - Ideation-specific storage
- `crates/forge-persist/src/insights_store.rs` - Insights-specific storage
- `crates/forge-persist/src/changelog_store.rs` - Changelog-specific storage

**Files to Modify**:
- `crates/forge-persist/src/lib.rs` - Export new modules
- `crates/forge-tauri/src/state.rs` - Add persistent stores to AppState
- `crates/forge-tauri/src/ipc/roadmap.rs` - Use persistent storage
- `crates/forge-tauri/src/ipc/ideation.rs` - Use persistent storage
- `crates/forge-tauri/src/ipc/insights.rs` - Use persistent storage
- `crates/forge-tauri/src/ipc/changelog.rs` - Use persistent storage

**Steps**:

1. Create `ContentStore` trait:
```rust
#[async_trait]
pub trait ContentStore<T>: Send + Sync {
    async fn save(&self, project_id: &str, item: T) -> Result<()>;
    async fn get(&self, project_id: &str, id: &str) -> Result<Option<T>>;
    async fn list(&self, project_id: &str) -> Result<Vec<T>>;
    async fn delete(&self, project_id: &str, id: &str) -> Result<()>;
}
```

2. Create Sled-backed implementations:
   - Use bincode serialization (matching existing patterns)
   - Tree per content type: `roadmaps`, `ideation_sessions`, `insights`, `changelogs`
   - Index by project_id for fast listing
   - Support pagination for large result sets

3. Storage paths:
```
.forge/
├── content_db/           (new Sled DB)
│   ├── roadmaps          (tree)
│   ├── ideation          (tree)
│   ├── insights          (tree)
│   ├── changelogs        (tree)
│   └── idx_project       (index tree)
```

4. Update managers to use persistent stores:
   - Replace `RwLock<HashMap>` with `Arc<dyn ContentStore>`
   - Load from disk on app start
   - Save on every mutation

**Verification**:
- [ ] Data survives app restart
- [ ] List operations return persisted data
- [ ] Deletion removes from disk
- [ ] No data corruption on concurrent access

---

### Phase 3: Integrate AI with Generation Handlers

**Objective**: Replace placeholder implementations in roadmap, ideation, insights, changelog with real AI calls.

**Files to Modify**:
- `crates/forge-tauri/src/ipc/roadmap.rs` - Lines 240-370
- `crates/forge-tauri/src/ipc/ideation.rs` - Lines 210-335
- `crates/forge-tauri/src/ipc/insights.rs` - Lines 700-725, 1272-1315 (chat)
- `crates/forge-tauri/src/ipc/changelog.rs` - Lines 262-293

**Steps**:

1. **roadmap_generate** (roadmap.rs:240):
   - Build prompt with project context, goal, constraints
   - Call `ai_service.generate_roadmap()`
   - Parse structured response into `Roadmap` type
   - Persist via `roadmap_store.save()`
   - Emit `roadmap-progress` events during generation
   - Emit `roadmap-complete` on success

2. **ideation_generate** (ideation.rs:210):
   - Build prompts per enabled `IdeationType`
   - Call `ai_service.generate_ideas()` for each type
   - Parse into `Idea` structs with proper types
   - Persist via `ideation_store.save()`
   - Emit `ideation-type-complete` as each type finishes
   - Emit `ideation-complete` when all done

3. **insights_generate** (insights.rs:701):
   - Gather project files and metadata
   - Build analysis prompt
   - Call `ai_service.generate_insights()`
   - Parse into `ProjectInsight` structs
   - Persist via `insights_store.save()`
   - Return generated insights

4. **insights_send_message** (insights.rs:1272):
   - Get chat session from `InsightsChatSessionManager`
   - Build conversation history
   - Call `ai_service.chat()` with streaming
   - Emit `insights-stream-chunk` events for each chunk
   - Update session with assistant response
   - Extract suggested tasks if any

5. **changelog_generate** (changelog.rs):
   - Gather commit history from git
   - Build prompt with commit messages and diffs
   - Call `ai_service.generate_changelog()`
   - Format according to `ChangelogFormat` preference
   - Persist via `changelog_store.save()`

**Error Handling**:
- AI rate limits: Return friendly error, suggest retry
- Token limits: Truncate context intelligently
- Network failures: Retry with exponential backoff
- Invalid responses: Log and return structured error

**Verification**:
- [ ] Each generate function produces meaningful content
- [ ] Progress events emit correctly
- [ ] Generated content persists across restart
- [ ] Error cases handled gracefully

---

### Phase 4: Claude CLI Terminal Integration

**Objective**: Implement `terminal_invoke_claude` and `terminal_resume_claude` for interactive Claude sessions.

**Files to Modify**:
- `crates/forge-tauri/src/ipc/terminal.rs` - Lines 997-1051
- `crates/forge-tauri/src/ipc/claude.rs` - Integration points
- `crates/forge-tauri/src/terminal/actor.rs` - Command handling

**Files to Create**:
- `crates/forge-tauri/src/terminal/claude_session.rs` - Claude session state management

**Steps**:

1. **terminal_invoke_claude** (terminal.rs:997):
   - Check Claude CLI exists via `which claude`
   - Get active Claude profile and token
   - Build command: `claude --api-key $TOKEN` or use OAuth
   - Write command to PTY
   - Set up output monitoring for session ID capture
   - Emit `terminal-claude-session` event with session info

2. **terminal_resume_claude** (terminal.rs:1029):
   - Validate session_id exists
   - Build resume command: `claude resume $SESSION_ID`
   - Write command to PTY
   - Monitor for session restoration confirmation

3. **ClaudeSession** tracking:
```rust
pub struct ClaudeSession {
    session_id: String,
    terminal_id: String,
    started_at: u64,
    last_activity: u64,
    status: ClaudeSessionStatus,
}

pub enum ClaudeSessionStatus {
    Active,
    Paused,
    Completed,
    Error(String),
}
```

4. **Session persistence**:
   - Store active sessions in Sled
   - Restore on app restart
   - Clean up completed/errored sessions

5. **Rate limit handling**:
   - Monitor terminal output for rate limit messages
   - Parse usage data from Claude output
   - Emit `terminal-rate-limit` events
   - Trigger profile auto-switch if configured

**Verification**:
- [ ] `terminal_invoke_claude` launches Claude in terminal
- [ ] `terminal_resume_claude` continues previous session
- [ ] Session state persists across terminal recreation
- [ ] Rate limits detected and handled

---

### Phase 5: Terminal Session Persistence

**Objective**: Implement terminal session save/restore functionality.

**Files to Modify**:
- `crates/forge-tauri/src/ipc/terminal.rs` - Lines 860-980 (stubs)

**Files to Create**:
- `crates/forge-tauri/src/terminal/session_store.rs` - Session persistence

**Steps**:

1. **TerminalSessionStore**:
```rust
pub struct TerminalSession {
    id: String,
    name: String,
    cwd: PathBuf,
    buffer: Vec<u8>,  // Compressed with LZ4
    created_at: u64,
    saved_at: u64,
}

pub struct TerminalSessionStore {
    db: sled::Db,
}
```

2. **terminal_save_buffer** (terminal.rs:980):
   - Get terminal handle
   - Capture current buffer content
   - Compress with LZ4
   - Store with session metadata
   - Return saved session info

3. **terminal_list_sessions** (terminal.rs:860):
   - Query session store
   - Group by date
   - Return session summaries

4. **terminal_restore_session** (terminal.rs:878):
   - Load session from store
   - Create new terminal with same CWD
   - Write buffer to output (for display)
   - Set terminal name
   - Return new terminal handle

5. **terminal_get_session_dates** (terminal.rs:918):
   - Query index for unique dates
   - Return sorted date list

6. **terminal_clear_sessions** (terminal.rs:899):
   - Delete sessions older than retention period
   - Or delete all if no filter specified

**Storage path**:
```
.forge/
├── terminal_sessions/    (new directory)
│   ├── sessions.db       (Sled)
│   └── buffers/          (LZ4 compressed files)
```

**Verification**:
- [ ] Sessions save correctly
- [ ] Restore creates functional terminal
- [ ] Buffer content preserved
- [ ] Cleanup works correctly

---

### Phase 6: GitHub API Implementation

**Objective**: Complete GitHub OAuth and API integration.

**Files to Modify**:
- `crates/forge-tauri/src/integrations/github.rs` - Lines 629-1289 (API calls), 1935-1963 (investigation)

**Steps**:

1. **Ensure OAuth token exchange works**:
   - Already implemented at lines 788-835
   - Verify `POST https://github.com/login/oauth/access_token` works
   - Store token with proper scopes

2. **Complete API call implementations** (most exist, verify):
   - `fetch_github_user` (lines 629-651) - Already implemented
   - `list_user_repos` (lines 904-965) - Already implemented
   - `list_issues` - Verify pagination
   - `create_issue` (lines 1061-1128) - Already implemented
   - `get_issue_comments` - Already implemented

3. **Implement github_investigate_issue** (lines 1935-1963):
   - Fetch issue details
   - Fetch all comments
   - Fetch related code references
   - Call AI service to analyze
   - Emit progress events
   - Return investigation report

4. **Error handling**:
   - Rate limiting (check X-RateLimit headers)
   - Token expiration (return auth error)
   - Network failures (retry logic)

**Verification**:
- [ ] OAuth flow completes successfully
- [ ] API calls return real data
- [ ] Rate limits handled gracefully
- [ ] Issue investigation produces useful output

---

### Phase 7: Linear API Implementation

**Objective**: Complete Linear OAuth and GraphQL API integration.

**Files to Modify**:
- `crates/forge-tauri/src/integrations/linear.rs` - Lines 548-779

**Steps**:

1. **Implement linear_auth_callback** (lines 548-582):
```rust
// Token exchange request
let response = client
    .post("https://api.linear.app/oauth/token")
    .form(&[
        ("client_id", config.client_id),
        ("client_secret", config.client_secret),
        ("code", request.code),
        ("redirect_uri", config.redirect_uri),
        ("grant_type", "authorization_code"),
    ])
    .send()
    .await?;

let token_response: LinearTokenResponse = response.json().await?;
manager.set_token(token_response.access_token, token_response.expires_in);
```

2. **Implement linear_teams_list** (lines 613-679):
```rust
// GraphQL query
let query = r#"
    query {
        teams {
            nodes {
                id
                name
                key
            }
        }
    }
"#;
let response = graphql_request(token, query, None).await?;
```

3. **Implement linear_projects_list** (lines 684-749):
```rust
let query = r#"
    query($teamId: String!) {
        team(id: $teamId) {
            projects {
                nodes {
                    id
                    name
                    state
                }
            }
        }
    }
"#;
```

4. **Implement linear_issues_list** (lines 754-819):
```rust
let query = r#"
    query($filter: IssueFilter) {
        issues(filter: $filter) {
            nodes {
                id
                title
                description
                state { name }
                priority
                assignee { name }
            }
        }
    }
"#;
```

5. **Implement linear_import_issues**:
   - Fetch issues matching filter
   - Convert to Task format
   - Create tasks via task_create
   - Return import summary

6. **Helper function for GraphQL**:
```rust
async fn graphql_request<T: DeserializeOwned>(
    token: &str,
    query: &str,
    variables: Option<serde_json::Value>,
) -> Result<T> {
    let client = create_client()?;
    let response = client
        .post("https://api.linear.app/graphql")
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "query": query,
            "variables": variables
        }))
        .send()
        .await?;
    // Parse and return
}
```

**Verification**:
- [ ] OAuth flow completes successfully
- [ ] Teams list returns real teams
- [ ] Projects list returns projects
- [ ] Issues list returns issues
- [ ] Import creates tasks correctly

---

### Phase 8: Infrastructure Handlers

**Objective**: Implement infrastructure status and Docker/FalkorDB handlers.

**Files to Modify**:
- `crates/forge-tauri/src/ipc/` - Add infrastructure.rs if not exists

**Steps**:

1. **infra_get_status**:
   - Check Docker daemon running
   - Check FalkorDB container status
   - Return comprehensive status object

2. **infra_start_falkordb**:
   - Pull FalkorDB image if needed
   - Start container with proper config
   - Wait for health check
   - Return connection info

3. **infra_stop_falkordb**:
   - Stop FalkorDB container
   - Optionally remove container

4. **infra_validate_falkordb**:
   - Connect to FalkorDB
   - Run test query
   - Return validation result

5. **infra_test_graphiti**:
   - Verify Graphiti MCP connection
   - Test basic operations
   - Return test results

**Verification**:
- [ ] Docker status correctly detected
- [ ] FalkorDB starts and stops reliably
- [ ] Validation tests work
- [ ] Graphiti integration verified

---

### Phase 9: Remaining Stub Handlers

**Objective**: Implement remaining stub handlers identified in audit.

**Handlers to implement**:

1. **claude_fetch_usage** (claude.rs:1189):
   - Parse usage data from terminal output
   - Or call Claude API usage endpoint
   - Return structured usage data

2. **claude_request_usage_update** (claude.rs:1218):
   - Trigger background usage fetch
   - Emit usage-updated event when complete

3. **claude_retry_with_profile** (claude.rs:1232):
   - Switch to specified profile
   - Retry failed request
   - Return retry result

4. **app_check_update** / **app_download_update** / **app_install_update**:
   - Check for new app versions
   - Download update package
   - Install and restart

5. **autobuild_check_update** / **autobuild_download_update**:
   - Check for autobuild source updates
   - Download new version
   - Extract and replace

**Verification**:
- [ ] All handlers return real data
- [ ] No `NotImplemented` errors for user-facing features
- [ ] Updates work end-to-end

---

### Phase 10: Testing & Documentation

**Objective**: Comprehensive test coverage and documentation.

**Tests to Add**:

1. **Unit tests** for each service:
   - AI service with mock responses
   - Content stores with temp Sled DBs
   - Session stores with temp files

2. **Integration tests**:
   - AI service with real API (gated behind feature flag)
   - GitHub OAuth flow
   - Linear OAuth flow
   - Terminal Claude integration

3. **End-to-end tests**:
   - Roadmap generation → save → load → display
   - Ideation generation → convert to task
   - Insights chat conversation

**Documentation**:
- Update `docs/ARCHITECTURE.md` with AI service design
- Add `docs/AI_INTEGRATION.md` for setup instructions
- Update `docs/API_CONTRACTS.md` with new handlers

**Verification**:
- [ ] 90%+ code coverage for new code
- [ ] All integration tests pass
- [ ] Documentation complete and accurate

---

## Testing Strategy

### Unit Tests (Per Phase)
- Phase 1: AI service trait, mock implementations
- Phase 2: Content store CRUD operations
- Phase 3: Prompt building, response parsing
- Phase 4: Claude command building, session tracking
- Phase 5: Session serialization, compression
- Phase 6: GitHub API response parsing
- Phase 7: Linear GraphQL response parsing
- Phase 8: Docker command building
- Phase 9: Usage parsing, update checking

### Integration Tests
- AI service with real Claude API
- Persistence across app restarts
- Terminal PTY operations
- GitHub/Linear OAuth flows
- Docker container management

### Manual Testing
- Complete roadmap generation flow
- Ideation with all types enabled
- Insights chat conversation
- Terminal Claude session
- GitHub issue import
- Linear project sync

---

## Rollback Plan

Each phase is independently deployable:

1. **AI Service**: Remove from AppState, handlers fall back to placeholder
2. **Persistence**: Delete `.forge/content_db/`, reverts to in-memory
3. **Claude CLI**: Handlers return NotImplemented, no breaking change
4. **GitHub/Linear**: OAuth reverts to existing flow, API calls return errors
5. **Terminal Sessions**: Delete `.forge/terminal_sessions/`, no data loss

For complete rollback:
```bash
git checkout <previous-tag>
cargo build -p forge-tauri
```

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Claude API costs exceed budget | Medium | Medium | Implement token limits, model tier selection, caching |
| Rate limiting from GitHub/Linear | Low | Low | Implement exponential backoff, cache responses |
| Sled database corruption | Low | High | Add backup/restore, validate on startup |
| Claude CLI not installed | Medium | Low | Graceful fallback, clear error messages |
| PTY compatibility issues | Low | Medium | Test on macOS/Linux/Windows, use portable-pty abstractions |
| AI responses don't parse | Medium | Medium | Robust parsing, fallback to raw text, retry with different prompt |
| Token expiration during long operations | Low | Low | Refresh tokens proactively, handle mid-operation expiry |

---

## Open Questions

1. **AI Model Selection**: Should users be able to select models per-feature (e.g., Opus for roadmaps, Haiku for quick insights)?

2. **Caching Strategy**: Should AI responses be cached? For how long? Per-project or global?

3. **Offline Mode**: Should generated content work offline, or require connectivity for regeneration?

4. **Rate Limit Handling**: Should we queue requests when rate limited, or immediately notify user?

5. **GitHub App vs OAuth**: Should we support GitHub Apps for org-level access in addition to OAuth?

6. **Linear Webhooks**: Should we support real-time sync via webhooks in addition to polling?

---

## File Changes Summary

### New Files (15)
- `crates/forge-tauri/src/ai/mod.rs`
- `crates/forge-tauri/src/ai/service.rs`
- `crates/forge-tauri/src/ai/prompts.rs`
- `crates/forge-tauri/src/ai/config.rs`
- `crates/forge-persist/src/content.rs`
- `crates/forge-persist/src/roadmap_store.rs`
- `crates/forge-persist/src/ideation_store.rs`
- `crates/forge-persist/src/insights_store.rs`
- `crates/forge-persist/src/changelog_store.rs`
- `crates/forge-tauri/src/terminal/claude_session.rs`
- `crates/forge-tauri/src/terminal/session_store.rs`
- `docs/AI_INTEGRATION.md`
- Test files for each module

### Modified Files (20+)
- `crates/forge-tauri/src/lib.rs`
- `crates/forge-tauri/src/state.rs`
- `crates/forge-tauri/Cargo.toml`
- `crates/forge-persist/src/lib.rs`
- `crates/forge-tauri/src/ipc/roadmap.rs`
- `crates/forge-tauri/src/ipc/ideation.rs`
- `crates/forge-tauri/src/ipc/insights.rs`
- `crates/forge-tauri/src/ipc/changelog.rs`
- `crates/forge-tauri/src/ipc/terminal.rs`
- `crates/forge-tauri/src/ipc/claude.rs`
- `crates/forge-tauri/src/integrations/github.rs`
- `crates/forge-tauri/src/integrations/linear.rs`
- `crates/forge-tauri/src/terminal/actor.rs`
- `docs/ARCHITECTURE.md`
- `docs/API_CONTRACTS.md`

---

## Execution Order

For parallel execution with up to 6 agents:

**Wave 1** (Foundation - Sequential):
- Phase 1: AI Service Abstraction Layer

**Wave 2** (Core Infrastructure - Parallel):
- Phase 2: Persistence Layer (Agent 1)
- Phase 4: Claude CLI Integration (Agent 2)
- Phase 5: Terminal Session Persistence (Agent 3)

**Wave 3** (External APIs - Parallel):
- Phase 6: GitHub API (Agent 1)
- Phase 7: Linear API (Agent 2)
- Phase 8: Infrastructure Handlers (Agent 3)

**Wave 4** (Integration - Parallel):
- Phase 3: AI Integration with Handlers (Agents 1-4, split by feature)
- Phase 9: Remaining Stubs (Agents 5-6)

**Wave 5** (Finalization - Sequential):
- Phase 10: Testing & Documentation

---

**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
