# Implementation Plan: Run App & Validate Claude Code Integration

Created: 2025-12-20
Status: PENDING APPROVAL

## Summary

This plan covers running the Forge Tauri desktop application for the first time and validating that Claude Code authentication integration works. We'll start the UI dev server, launch the Tauri app, and either verify Claude Code commands work or implement the missing Claude profile IPC handlers.

## Scope

### In Scope

1. Run the application (UI dev server + Tauri backend)
2. Verify the app launches and displays the React UI
3. Identify and fix any runtime errors
4. Validate Claude Code authentication flow:
   - Check if `claude_get_profiles` and related commands are implemented
   - Implement missing Claude profile IPC handlers if needed
   - Test the OAuth flow with `claude setup-token`

### Out of Scope

- Full end-to-end testing of all 70+ IPC commands
- Production build and bundling
- Additional feature implementations beyond Claude auth
- Linux/Windows testing (macOS only)

## Prerequisites

- [x] Rust toolchain installed (verified via previous cargo build)
- [x] Node.js 18+ installed
- [x] pnpm installed
- [ ] Tauri CLI v2 installed (`cargo install tauri-cli --version "^2" --locked`)
- [ ] UI dependencies installed (`cd ui && pnpm install`)
- [ ] Claude Code CLI installed on system (`claude` command available)

## Implementation Phases

### Phase 1: Install Prerequisites and Prepare Environment

**Objective**: Ensure all required tools and dependencies are ready

**Steps**:
1. Check if `cargo tauri` CLI is installed: `cargo tauri --version`
2. If not installed: `cargo install tauri-cli --version "^2" --locked`
3. Install UI dependencies: `cd ui && pnpm install`
4. Check if `claude` CLI is available: `which claude`

**Verification**:
- [ ] `cargo tauri --version` returns version 2.x
- [ ] `pnpm install` completes without errors
- [ ] `claude --version` returns Claude Code version

---

### Phase 2: Start UI Development Server

**Objective**: Launch the Vite dev server for the React frontend

**Steps**:
1. Navigate to UI directory: `cd /Users/aiml/Projects/forge/forge-project/ui`
2. Start dev server: `pnpm dev`
3. Verify server starts on port 5173

**Verification**:
- [ ] Vite dev server running at http://localhost:5173
- [ ] No build/compilation errors

---

### Phase 3: Launch Tauri Application

**Objective**: Build and run the Tauri desktop application

**Steps**:
1. In a new terminal, navigate to: `cd /Users/aiml/Projects/forge/forge-project/crates/forge-tauri`
2. Run Tauri dev: `cargo tauri dev`
3. Wait for Rust compilation and window to open
4. Observe any errors in the console

**Expected Behavior**:
- Desktop window opens with title "Forge"
- React UI loads inside the window
- Console shows Tauri/Rust logs

**Verification**:
- [ ] Window opens successfully
- [ ] React UI renders (not blank)
- [ ] No immediate crashes

---

### Phase 4: Identify Missing Claude Profile Commands

**Objective**: Determine what Claude Code commands are missing from the Rust backend

**Current State Analysis**:

The frontend (`tauri-api.ts`) expects these Claude profile commands:
| Frontend Command | Tauri Invoke | Implemented in main.rs? |
|-----------------|--------------|------------------------|
| `getClaudeProfiles` | `claude_get_profiles` | **NO** |
| `saveClaudeProfile` | `claude_save_profile` | **NO** |
| `deleteClaudeProfile` | `claude_delete_profile` | **NO** |
| `renameClaudeProfile` | `claude_rename_profile` | **NO** |
| `setActiveClaudeProfile` | `claude_set_active_profile` | **NO** |
| `switchClaudeProfile` | `claude_switch_profile` | **NO** |
| `initializeClaudeProfile` | `claude_initialize_profile` | **NO** |
| `setClaudeProfileToken` | `claude_set_profile_token` | **NO** |
| `getAutoSwitchSettings` | `claude_get_auto_switch_settings` | **NO** |
| `updateAutoSwitchSettings` | `claude_update_auto_switch_settings` | **NO** |
| `fetchClaudeUsage` | `claude_fetch_usage` | **NO** |
| `getBestAvailableProfile` | `claude_get_best_profile` | **NO** |
| `retryWithProfile` | `claude_retry_with_profile` | **NO** |
| `requestUsageUpdate` | `claude_request_usage_update` | **NO** |
| `checkClaudeAuth` | (not in list) | **NO** |
| `invokeClaudeSetup` | (not in list) | **NO** |

**Steps**:
1. Attempt to navigate to Claude profile settings in the UI
2. Check browser dev tools console for invoke errors
3. Document which commands fail

**Verification**:
- [ ] List of missing commands identified
- [ ] Console errors documented

---

### Phase 5: Implement Claude Profile IPC Module

**Objective**: Create the Claude profile management IPC module

**Files to Create**:
- `crates/forge-tauri/src/ipc/claude_profile.rs` - Claude profile management

**Files to Modify**:
- `crates/forge-tauri/src/ipc/mod.rs` - Export new module
- `crates/forge-tauri/src/main.rs` - Register new commands

**Implementation Approach**:

The Claude profile system manages:
1. **Profile Storage**: JSON-based profile settings stored in app data directory
2. **Token Management**: OAuth tokens (sk-ant-oat01-...) for Claude Code CLI
3. **Terminal Integration**: Running `claude setup-token` to authenticate
4. **Auto-switching**: Switching profiles when rate limits are hit

**Core Types** (to be added to `ipc/types.rs`):
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProfile {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub created_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProfileSettings {
    pub profiles: Vec<ClaudeProfile>,
    pub active_profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAutoSwitchSettings {
    pub enabled: bool,
    pub session_threshold: u32,
    pub weekly_threshold: u32,
}
```

**Key Functions**:
1. `claude_get_profiles()` - Load profiles from storage
2. `claude_save_profile(profile)` - Save/update a profile
3. `claude_set_profile_token(profile_id, token, email)` - Set OAuth token
4. `claude_initialize_profile(profile_id)` - Run `claude setup-token` in terminal
5. Event emission for `terminal-oauth-token` when token detected

**Verification**:
- [ ] All 14 Claude profile commands implemented
- [ ] Commands registered in main.rs
- [ ] Build succeeds: `cargo build -p forge-tauri`

---

### Phase 6: Test Claude Code Authentication Flow

**Objective**: Verify the full OAuth flow works end-to-end

**Steps**:
1. Start the app again with new commands
2. Navigate to Claude authentication settings
3. Click "Authenticate with Claude" button
4. Verify terminal opens with `claude setup-token`
5. Complete OAuth in browser
6. Verify token is detected and saved
7. Confirm success message appears

**Verification**:
- [ ] OAuth flow completes without errors
- [ ] Token saved to profile
- [ ] Profile shows as authenticated

---

## Testing Strategy

**Manual Testing**:
1. Start UI dev server
2. Launch Tauri app
3. Verify window opens and renders
4. Test Claude authentication flow
5. Verify profile is saved after authentication

**Unit Tests** (optional):
- Claude profile storage/retrieval
- Token parsing from terminal output

---

## Rollback Plan

If something goes wrong:
1. The Rust code changes are isolated to new files
2. Can revert by removing claude_profile.rs and reverting main.rs changes
3. UI is unchanged - no frontend modifications needed

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Tauri CLI not compatible with project | Low | High | Use exact version from README |
| Claude CLI not installed | Med | Med | Document installation steps |
| PTY token detection fails | Med | Med | Add extensive logging, test patterns |
| Profile storage permissions | Low | Med | Use Tauri app data directory |

---

## Open Questions

1. **Should we block on Claude profile implementation to run the app?**
   - Option A: Run app first, see what breaks, then fix
   - Option B: Implement Claude profiles first, then run

2. **How should profiles be stored?**
   - Option A: JSON file in Tauri app data directory
   - Option B: Use existing forge-store/sled database

**Recommendation**: Run the app first (Phase 1-3), identify actual failures, then implement only what's needed.

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
