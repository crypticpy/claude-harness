# Implementation Plan: Forge Claude Code Authentication Fix

Created: 2025-12-21
Status: PENDING APPROVAL

## Summary

The Claude Code authentication workflow in Forge is broken. When users click "Add" to create a new profile in the Startup Wizard or Settings page, the profile is saved but the OAuth flow never starts (no browser opens, no terminal is visible for the login command). This plan fixes the full authentication workflow to be production-ready.

## Root Cause Analysis

Based on code review, the authentication flow has these components:

1. **Frontend** (`OAuthStep.tsx` / `IntegrationSettings.tsx`):
   - Calls `saveClaudeProfile()` to create profile
   - Calls `initializeClaudeProfile()` to start OAuth flow
   - Listens for `terminal-oauth-token` event for completion

2. **Backend** (`setup_handlers.rs`):
   - `claude_initialize_profile()` creates a hidden terminal, sends `claude login\n`
   - Terminal output is monitored for OAuth tokens via regex
   - Token is emitted via `terminal-oauth-token` event

**Identified Issues:**

1. **Terminal is invisible**: The terminal is created but NOT shown to the user - they can't see the Claude CLI's browser login prompt or interact with it
2. **No browser launch detection**: The `claude login` command should open a browser, but if it fails, there's no feedback
3. **Event not reaching frontend**: The `terminal-oauth-token` event may not be properly reaching the frontend listeners
4. **No error handling feedback**: Failures in the flow don't propagate to the UI

## Scope

### In Scope
- Fix terminal visibility so users can see the Claude login process
- Ensure browser opens for OAuth authentication
- Fix event emission and reception for OAuth completion
- Add proper error handling and user feedback
- Make the flow work for both Startup Wizard and Settings page

### Out of Scope
- Refactoring the overall profile management architecture
- Adding new authentication methods (API keys, etc.)
- Changing the keychain storage mechanism
- UI/UX redesign of the authentication flow

## Prerequisites
- Ensure `claude` CLI is installed (`npm install -g @anthropic-ai/claude-code`)
- Tauri v2 development environment set up
- Forge project builds successfully

## Implementation Phases

### Phase 1: Diagnose Current Terminal Behavior
**Objective**: Understand why terminals created for OAuth don't show and why `claude login` doesn't work

**Files to Examine**:
- `/Users/aiml/Projects/forge/forge-project/crates/forge-tauri/src/terminal/mod.rs` - Terminal module
- `/Users/aiml/Projects/forge/forge-project/crates/forge-tauri/src/terminal/manager.rs` - Terminal manager implementation

**Steps**:
1. Trace the terminal creation flow in `claude_initialize_profile`
2. Verify if terminal output is being captured and forwarded
3. Check if `claude login` command output is being monitored
4. Test the OAuth token regex pattern against actual Claude CLI output

**Verification**:
- [ ] Console shows terminal creation success
- [ ] Terminal output events are emitted

### Phase 2: Fix Terminal Visibility for OAuth Flow
**Objective**: Make the OAuth terminal visible to users so they can see the login process

**Files to Modify**:
- `/Users/aiml/Projects/forge/forge-project/crates/forge-tauri/src/ipc/claude/setup_handlers.rs` - Add terminal visibility logic

**New Files to Create**:
- None (will modify existing files)

**Steps**:
1. Modify `claude_initialize_profile` to return terminal ID to frontend
2. Update frontend to show a terminal modal/panel for the OAuth process
3. Add a visible indicator showing "Waiting for authentication..."
4. Ensure the terminal session is properly linked to the profile being authenticated

**Verification**:
- [ ] Terminal appears when clicking "Add" with new profile name
- [ ] User can see Claude CLI output
- [ ] User can see the browser login URL

### Phase 3: Improve OAuth Token Detection
**Objective**: Ensure OAuth tokens are properly detected and stored

**Files to Modify**:
- `/Users/aiml/Projects/forge/forge-project/crates/forge-tauri/src/ipc/claude/setup_handlers.rs` - Improve token detection

**Steps**:
1. Review the regex pattern for token detection: `r"sk-ant-oat01-[a-zA-Z0-9_-]+"`
2. Test against actual Claude CLI authentication output
3. Add detection for success messages like "Successfully authenticated"
4. Ensure token is saved to keychain via `set_profile_token`
5. Emit the `terminal-oauth-token` event with correct payload structure

**Verification**:
- [ ] Token is detected from Claude CLI output
- [ ] Token is stored in keychain
- [ ] Event is emitted to frontend

### Phase 4: Fix Frontend Event Handling
**Objective**: Ensure frontend properly receives and handles OAuth completion events

**Files to Modify**:
- `/Users/aiml/Projects/forge/forge-project/ui/src/components/onboarding/OAuthStep.tsx`
- `/Users/aiml/Projects/forge/forge-project/ui/src/components/settings/IntegrationSettings.tsx`
- `/Users/aiml/Projects/forge/forge-project/ui/src/lib/tauri-api.ts`

**Steps**:
1. Verify event listener setup in `onTerminalOAuthToken`
2. Ensure proper cleanup of event listeners
3. Add visual feedback when authentication completes
4. Reload profiles after successful authentication
5. Handle error cases gracefully

**Verification**:
- [ ] Frontend receives `terminal-oauth-token` event
- [ ] Profile list updates to show "Authenticated" badge
- [ ] Success alert appears

### Phase 5: Add Error Handling and User Feedback
**Objective**: Provide clear feedback when authentication fails

**Files to Modify**:
- `/Users/aiml/Projects/forge/forge-project/crates/forge-tauri/src/ipc/claude/setup_handlers.rs`
- `/Users/aiml/Projects/forge/forge-project/ui/src/components/onboarding/OAuthStep.tsx`
- `/Users/aiml/Projects/forge/forge-project/ui/src/components/settings/IntegrationSettings.tsx`

**Steps**:
1. Add timeout detection for OAuth flow (e.g., 5 minutes)
2. Detect Claude CLI errors in terminal output
3. Emit failure events with error details
4. Show user-friendly error messages
5. Allow retry without recreating profile

**Verification**:
- [ ] Timeout shows clear error message
- [ ] CLI errors are reported to user
- [ ] User can retry authentication

### Phase 6: End-to-End Testing
**Objective**: Verify complete flow works in production build

**Steps**:
1. Build Forge in release mode
2. Test Startup Wizard OAuth flow
3. Test Settings page OAuth flow
4. Test with Claude CLI installed
5. Test error case when Claude CLI not installed
6. Verify keychain storage works

**Verification**:
- [ ] New profile + OAuth works in Startup Wizard
- [ ] Add account + OAuth works in Settings
- [ ] Profile shows as authenticated
- [ ] Token persists across app restart

## Testing Strategy

### Unit Tests
- Test OAuth token regex pattern against various token formats
- Test ClaudeProfileManager token storage/retrieval
- Test event emission payloads

### Integration Tests
- Test terminal creation and output capture
- Test profile save + initialize flow
- Test keychain integration

### Manual Testing Steps
1. Start Forge fresh (or clear settings)
2. Reach OAuth step in wizard
3. Enter profile name, click "Add"
4. Verify terminal appears with Claude CLI
5. Complete browser authentication
6. Verify profile shows "Authenticated"
7. Close and reopen app
8. Verify profile is still authenticated

## Rollback Plan

1. Revert commits if issues found
2. Previous authentication state preserved (changes don't delete existing profiles)
3. If terminal changes break other features, can isolate OAuth terminal handling

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Terminal display breaks existing terminal grid | Medium | High | OAuth terminals use separate display mode, don't affect grid |
| Claude CLI not installed on user machine | High | Medium | Clear error message with install instructions |
| Keychain unavailable on some Linux systems | Medium | Low | Fallback to JSON storage already exists |
| OAuth token format changes | Low | High | Make regex pattern configurable, add logging for debugging |
| Browser doesn't open from terminal | Medium | Medium | Detect and show manual URL for user to copy |

## Open Questions

1. **Should OAuth terminal be a modal popup or inline panel?** - Need user input on preferred UX
2. **Should we add a "Use manual token entry" as fallback?** - Already exists but could be more prominent
3. **Should we validate tokens by making an API call after storage?** - Would ensure token works before showing success

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
