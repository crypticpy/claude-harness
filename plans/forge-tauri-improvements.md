# Implementation Plan: Forge Tauri Code Quality & Security Improvements

Created: 2025-12-20
Status: PENDING APPROVAL

## Summary

This plan addresses 6 improvement areas identified during code review: secure credential storage via platform keychain, code splitting of large files into submodules, replacing blocking I/O with async, adding input validation, implementing AI service retry logic, and fixing HTTP client error handling. Work is organized into parallel work packages that independent sub-agents can execute.

## Scope

### In Scope
- Secure credential storage using `keyring` crate for cross-platform keychain access
- Splitting 3 large files (github.rs: 2760 lines, linear.rs: 1943 lines, claude.rs: 1552 lines) into submodules
- Converting blocking `std::process::Command` to async `tokio::process::Command` in GitHub CLI operations
- Adding input validation for repository names, container names, and other user inputs
- Implementing retry logic with exponential backoff for AI service calls
- Replacing `expect()` panics with proper `Result` error handling in AI service

### Out of Scope
- Frontend changes (TypeScript/React)
- Changes to other crates beyond forge-tauri
- Adding new features (only improving existing code)
- Changes to the orchestrator or agent crates

## Prerequisites
- Rust toolchain installed
- Access to forge-tauri crate
- `keyring` crate available (will be added to Cargo.toml)

---

## Implementation Phases

### Phase 1: Secure Credential Storage (Work Package A)

**Objective**: Replace plain JSON file storage for OAuth tokens with platform-native secure storage using the `keyring` crate.

**Assigned Agent**: backend-engineer (Opus model)

**Files to Modify**:
- `crates/forge-tauri/Cargo.toml` - Add `keyring = "2"` dependency
- `crates/forge-tauri/src/ipc/claude.rs` - Replace JSON token storage with keychain
- `crates/forge-tauri/src/integrations/github.rs` - Add secure token storage option
- `crates/forge-tauri/src/integrations/linear.rs` - Add secure token storage option

**New Files to Create**:
- `crates/forge-tauri/src/security/mod.rs` - Security utilities module
- `crates/forge-tauri/src/security/keychain.rs` - Cross-platform keychain wrapper

**Steps**:
1. Add `keyring = "2"` to forge-tauri Cargo.toml dependencies
2. Create `security/` module with keychain wrapper that handles:
   - macOS Keychain
   - Windows Credential Manager
   - Linux Secret Service (via libsecret)
3. Implement `SecureTokenStore` trait with `store_token()`, `get_token()`, `delete_token()` methods
4. Update `ClaudeProfileManager` to use keychain for `oauth_token` field instead of JSON
5. Keep JSON file for non-sensitive profile metadata (name, email, settings)
6. Add fallback to JSON storage if keychain unavailable (with warning)
7. Update GitHub/Linear managers to optionally use keychain for access tokens

**Verification**:
- [ ] Tokens stored in platform keychain, not in JSON file
- [ ] `cargo build` passes
- [ ] `cargo test` passes
- [ ] Token retrieval works after app restart

---

### Phase 2: Code Splitting - GitHub Integration (Work Package B)

**Objective**: Split `github.rs` (2760 lines) into logical submodules under `integrations/github/` directory.

**Assigned Agent**: backend-engineer (Opus model)

**Files to Modify**:
- `crates/forge-tauri/src/integrations/mod.rs` - Update imports

**New Files to Create**:
- `crates/forge-tauri/src/integrations/github/mod.rs` - Module root with re-exports (~100 lines)
- `crates/forge-tauri/src/integrations/github/types.rs` - Public types and request structs (~300 lines)
- `crates/forge-tauri/src/integrations/github/manager.rs` - GitHubManager and OAuth state (~200 lines)
- `crates/forge-tauri/src/integrations/github/client.rs` - HTTP client, retry logic, rate limiting (~400 lines)
- `crates/forge-tauri/src/integrations/github/oauth.rs` - OAuth flow handlers (~300 lines)
- `crates/forge-tauri/src/integrations/github/api.rs` - API operation handlers (~400 lines)
- `crates/forge-tauri/src/integrations/github/cli.rs` - GitHub CLI (gh) wrappers (~400 lines)
- `crates/forge-tauri/src/integrations/github/project.rs` - Project-based handlers (~500 lines)

**Files to Delete**:
- `crates/forge-tauri/src/integrations/github.rs` (after migration)

**Steps**:
1. Create `integrations/github/` directory
2. Create `mod.rs` with module declarations and re-exports
3. Extract types to `types.rs` (StoredToken, GitHubUser, GitHubRepo, etc.)
4. Extract manager to `manager.rs` (GitHubManager, OAuth state)
5. Extract HTTP utilities to `client.rs` (retry, rate limiting, helpers)
6. Extract OAuth handlers to `oauth.rs`
7. Extract API handlers to `api.rs`
8. Extract CLI handlers to `cli.rs`
9. Extract project handlers to `project.rs`
10. Update `integrations/mod.rs` to use `mod github;` instead of single file
11. Ensure all public exports remain unchanged (API compatibility)
12. Delete original `github.rs`

**Verification**:
- [ ] `cargo build` passes
- [ ] `cargo test` passes
- [ ] All existing public exports still work
- [ ] Each submodule is under 500 lines

---

### Phase 3: Code Splitting - Linear Integration (Work Package C)

**Objective**: Split `linear.rs` (1943 lines) into logical submodules under `integrations/linear/` directory.

**Assigned Agent**: backend-engineer (Opus model)

**Files to Modify**:
- `crates/forge-tauri/src/integrations/mod.rs` - Update imports

**New Files to Create**:
- `crates/forge-tauri/src/integrations/linear/mod.rs` - Module root (~80 lines)
- `crates/forge-tauri/src/integrations/linear/types.rs` - Public types (~200 lines)
- `crates/forge-tauri/src/integrations/linear/manager.rs` - LinearManager (~200 lines)
- `crates/forge-tauri/src/integrations/linear/graphql.rs` - GraphQL types and execution (~300 lines)
- `crates/forge-tauri/src/integrations/linear/oauth.rs` - OAuth handlers (~200 lines)
- `crates/forge-tauri/src/integrations/linear/handlers.rs` - API handlers (~500 lines)
- `crates/forge-tauri/src/integrations/linear/project.rs` - Project-based handlers (~400 lines)

**Files to Delete**:
- `crates/forge-tauri/src/integrations/linear.rs` (after migration)

**Steps**:
1. Create `integrations/linear/` directory
2. Create `mod.rs` with module declarations and re-exports
3. Extract types to `types.rs`
4. Extract manager to `manager.rs`
5. Extract GraphQL logic to `graphql.rs`
6. Extract OAuth handlers to `oauth.rs`
7. Extract API handlers to `handlers.rs`
8. Extract project handlers to `project.rs`
9. Update `integrations/mod.rs`
10. Delete original `linear.rs`

**Verification**:
- [ ] `cargo build` passes
- [ ] `cargo test` passes
- [ ] Each submodule is under 500 lines

---

### Phase 4: Code Splitting - Claude Integration (Work Package D)

**Objective**: Split `claude.rs` (1552 lines) into logical submodules under `ipc/claude/` directory.

**Assigned Agent**: backend-engineer (Opus model)

**Files to Modify**:
- `crates/forge-tauri/src/ipc/mod.rs` - Update imports

**New Files to Create**:
- `crates/forge-tauri/src/ipc/claude/mod.rs` - Module root (~60 lines)
- `crates/forge-tauri/src/ipc/claude/types.rs` - Data types (usage, profiles, settings) (~250 lines)
- `crates/forge-tauri/src/ipc/claude/manager.rs` - ClaudeProfileManager (~400 lines)
- `crates/forge-tauri/src/ipc/claude/profile_handlers.rs` - Profile CRUD handlers (~200 lines)
- `crates/forge-tauri/src/ipc/claude/setup_handlers.rs` - Setup and terminal handlers (~350 lines)
- `crates/forge-tauri/src/ipc/claude/usage_handlers.rs` - Usage monitoring handlers (~200 lines)

**Files to Delete**:
- `crates/forge-tauri/src/ipc/claude.rs` (after migration)

**Steps**:
1. Create `ipc/claude/` directory
2. Create `mod.rs` with module declarations and re-exports
3. Extract types to `types.rs`
4. Extract manager to `manager.rs`
5. Extract profile handlers to `profile_handlers.rs`
6. Extract setup handlers to `setup_handlers.rs`
7. Extract usage handlers to `usage_handlers.rs`
8. Update `ipc/mod.rs`
9. Delete original `claude.rs`

**Verification**:
- [ ] `cargo build` passes
- [ ] `cargo test` passes
- [ ] Each submodule is under 500 lines

---

### Phase 5: Async Process Execution (Work Package E)

**Objective**: Replace blocking `std::process::Command` with async `tokio::process::Command` in GitHub CLI operations.

**Assigned Agent**: backend-engineer (Opus model)

**Files to Modify**:
- `crates/forge-tauri/src/integrations/github/cli.rs` (after Phase 2) OR `github.rs` (if Phase 2 not done)
  - `github_check_cli()` - Lines 1731-1764
  - `github_check_auth()` - Lines 1768-1798
  - `github_get_token()` - Lines 1822-1845
  - `github_get_user()` - Lines 1849-1877
  - `github_list_user_repos()` - Lines 1881-1935
  - `github_detect_repo()` - Lines 1940-1983
  - `github_get_branches()` - Lines 1987-2023
  - `github_create_release()` - Lines 2462-2516

**Steps**:
1. Import `tokio::process::Command` (already available in tokio)
2. Replace each `std::process::Command::new("gh")` with `tokio::process::Command::new("gh")`
3. Change `.output()` to `.output().await`
4. Handle the `Result` from async output
5. Ensure all affected functions are already `async fn` (they are)

**Verification**:
- [ ] No `std::process::Command` in GitHub CLI operations
- [ ] `cargo build` passes
- [ ] `cargo test` passes
- [ ] GitHub CLI operations work correctly

---

### Phase 6: Input Validation (Work Package F)

**Objective**: Add input validation for repository names, container names, and other user-provided identifiers.

**Assigned Agent**: backend-engineer (Opus model)

**Files to Modify**:
- `crates/forge-tauri/src/integrations/github/client.rs` (or `github.rs`) - Add validation
- `crates/forge-tauri/src/ipc/infrastructure.rs` - Add container name validation

**New Files to Create**:
- `crates/forge-tauri/src/validation.rs` - Input validation utilities

**Steps**:
1. Create `validation.rs` module with validation functions:
   ```rust
   pub fn validate_github_owner(owner: &str) -> Result<(), String>;
   pub fn validate_github_repo(repo: &str) -> Result<(), String>;
   pub fn validate_container_name(name: &str) -> Result<(), String>;
   ```
2. GitHub owner/repo validation rules:
   - 1-39 characters
   - Alphanumeric, hyphens allowed
   - Cannot start with hyphen
   - Cannot be empty
3. Container name validation rules:
   - Alphanumeric, hyphens, underscores
   - Must start with letter or number
   - 1-128 characters
4. Add validation calls in `parse_owner_repo()` function
5. Add validation calls before Docker commands in infrastructure.rs
6. Return `IpcError::validation()` for invalid input

**Verification**:
- [ ] Invalid owner/repo names rejected with clear error
- [ ] Invalid container names rejected
- [ ] `cargo build` passes
- [ ] `cargo test` passes
- [ ] Add unit tests for validation functions

---

### Phase 7: AI Service Retry Logic (Work Package G)

**Objective**: Add retry logic with exponential backoff for AI service transient failures.

**Assigned Agent**: backend-engineer (Opus model)

**Files to Modify**:
- `crates/forge-tauri/src/ai/service.rs` - Add retry wrapper
- `crates/forge-tauri/src/ai/config.rs` - Add retry configuration

**Steps**:
1. Add retry configuration to `AiConfig`:
   ```rust
   pub max_retries: u32,       // Default: 3
   pub retry_base_delay_ms: u64, // Default: 1000
   pub max_retry_delay_ms: u64,  // Default: 30000
   ```
2. Create `is_retryable_error()` function for `AiError`:
   - Retry: `RateLimited`, `NetworkError`, `RequestFailed` (5xx status)
   - Don't retry: `NotConfigured`, `ParseError`, `ContextTooLarge`
3. Create `execute_with_retry()` wrapper in service.rs:
   ```rust
   async fn execute_with_retry<F, T>(&self, operation: F) -> AiResult<T>
   where F: Fn() -> Future<Output = AiResult<T>>
   ```
4. Implement exponential backoff with jitter
5. Honor `retry_after` from `AiError::RateLimited`
6. Update `api_request()` to use retry wrapper
7. Update `chat()` to use retry wrapper
8. Add logging for retry attempts

**Verification**:
- [ ] Transient errors are retried automatically
- [ ] Rate limit `retry_after` is honored
- [ ] Non-retryable errors fail immediately
- [ ] `cargo build` passes
- [ ] `cargo test` passes

---

### Phase 8: HTTP Client Error Handling (Work Package H)

**Objective**: Replace `expect()` panic in `ClaudeService::new()` with proper error handling.

**Assigned Agent**: backend-engineer (Opus model)

**Files to Modify**:
- `crates/forge-tauri/src/ai/service.rs` - Lines 306-319
- `crates/forge-tauri/src/state.rs` - Update initialization

**Steps**:
1. Change `ClaudeService::new()` signature:
   ```rust
   // Before
   pub fn new(config: AiConfig) -> Self

   // After
   pub fn new(config: AiConfig) -> Result<Self, AiError>
   ```
2. Replace `expect()` with `map_err()`:
   ```rust
   let client = Client::builder()
       .timeout(Duration::from_secs(config.timeout_secs))
       .build()
       .map_err(|e| AiError::NetworkError(format!("Failed to create HTTP client: {}", e)))?;
   ```
3. Update `from_env()` to also return `Result`:
   ```rust
   pub fn from_env() -> Result<Self, AiError>
   ```
4. Update `AppState` initialization to handle the Result
5. Optionally create `new_unchecked()` for tests that can use expect

**Verification**:
- [ ] No `expect()` in ClaudeService constructor
- [ ] Proper error returned if client creation fails
- [ ] `cargo build` passes
- [ ] `cargo test` passes

---

## Testing Strategy

### Unit Tests
- Add tests for `SecureTokenStore` (keychain wrapper)
- Add tests for validation functions
- Add tests for retry logic (using mock service)
- Update existing tests for split modules

### Integration Tests
- Test token storage/retrieval roundtrip
- Test async CLI command execution
- Test AI service with retry on mocked failures

### Manual Testing
- Verify tokens stored in system keychain (can check via Keychain Access on macOS)
- Verify async CLI operations don't block UI
- Verify validation errors display properly in frontend

---

## Rollback Plan

Each phase is independent:
1. **Keychain**: Revert Cargo.toml and remove security/ module, tokens stored in JSON
2. **Code splitting**: Restore original single files, update mod.rs
3. **Async CLI**: Revert to std::process::Command
4. **Validation**: Remove validation.rs and validation calls
5. **Retry logic**: Remove retry wrapper, revert to direct calls
6. **Error handling**: Revert to expect() if needed

Git commits should be atomic per phase for easy reversion.

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Keychain unavailable on some Linux distros | Medium | Low | Fallback to JSON with warning log |
| Code splitting breaks public API | Low | High | Keep all re-exports, run full test suite |
| Async CLI changes behavior | Low | Medium | Test all CLI operations manually |
| Validation too strict | Medium | Medium | Start with GitHub's official rules, add escape hatch |
| Retry causes excessive delays | Low | Medium | Cap max retry delay, add timeout |

---

## Parallel Execution Strategy

These phases can be executed in parallel by separate sub-agents:

**Wave 1** (Parallel):
- Phase 1: Secure Credential Storage (Work Package A)
- Phase 5: Async Process Execution (Work Package E)
- Phase 6: Input Validation (Work Package F)

**Wave 2** (Parallel, after Wave 1):
- Phase 2: Code Splitting - GitHub (Work Package B)
- Phase 3: Code Splitting - Linear (Work Package C)
- Phase 4: Code Splitting - Claude (Work Package D)

**Wave 3** (Parallel):
- Phase 7: AI Service Retry Logic (Work Package G)
- Phase 8: HTTP Client Error Handling (Work Package H)

**Final**: Integration testing and verification

---

## Sub-Agent Assignments

| Phase | Work Package | Agent Type | Model |
|-------|--------------|------------|-------|
| 1 | A - Keychain | backend-engineer | Opus |
| 2 | B - GitHub Split | backend-engineer | Opus |
| 3 | C - Linear Split | backend-engineer | Opus |
| 4 | D - Claude Split | backend-engineer | Opus |
| 5 | E - Async CLI | backend-engineer | Opus |
| 6 | F - Validation | backend-engineer | Opus |
| 7 | G - Retry Logic | backend-engineer | Opus |
| 8 | H - Error Handling | backend-engineer | Opus |

---

**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
