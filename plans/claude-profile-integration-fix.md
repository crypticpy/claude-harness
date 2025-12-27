# Implementation Plan: AppSettings 1:1 Alignment

Created: 2025-12-20
Status: PENDING APPROVAL

## Summary

Extend the Rust `AppSettings` struct to include ALL fields from the React `AppSettings` interface, creating a true 1:1 mapping. This will fix the settings persistence issues causing the onboarding wizard to reset and profiles to not save properly.

## Complete Field Mapping

### Current State Comparison

| React Field (TypeScript) | Rust Field | Status | Serde Rename |
|--------------------------|------------|--------|--------------|
| `theme` | `theme` | EXISTS | - |
| `defaultModel` | - | **MISSING** | `defaultModel` |
| `agentFramework` | - | **MISSING** | `agentFramework` |
| `pythonPath` | - | **MISSING** | `pythonPath` |
| `autoBuildPath` | - | **MISSING** | `autoBuildPath` |
| `autoUpdateAutoBuild` | - | **MISSING** | `autoUpdateAutoBuild` |
| `autoNameTerminals` | - | **MISSING** | `autoNameTerminals` |
| `notifications` | - | **MISSING** | `notifications` |
| `globalClaudeOAuthToken` | - | **MISSING** | `globalClaudeOAuthToken` |
| `globalOpenAIApiKey` | - | **MISSING** | `globalOpenAIApiKey` |
| `globalAnthropicApiKey` | - | **MISSING** | `globalAnthropicApiKey` |
| `globalGoogleApiKey` | - | **MISSING** | `globalGoogleApiKey` |
| `globalGroqApiKey` | - | **MISSING** | `globalGroqApiKey` |
| `graphitiLlmProvider` | - | **MISSING** | `graphitiLlmProvider` |
| `ollamaBaseUrl` | - | **MISSING** | `ollamaBaseUrl` |
| `onboardingCompleted` | `onboarding_completed` | EXISTS | `onboardingCompleted` |
| `selectedAgentProfile` | `selected_agent_profile` | EXISTS | `selectedAgentProfile` |
| `changelogFormat` | - | **MISSING** | `changelogFormat` |
| `changelogAudience` | - | **MISSING** | `changelogAudience` |
| `changelogEmojiLevel` | - | **MISSING** | `changelogEmojiLevel` |
| - | `editor` | **RUST-ONLY** | Consider keeping |
| - | `max_agents` | **RUST-ONLY** | Consider keeping |
| - | `api` (ApiSettings) | **RUST-ONLY** | Consider keeping |
| - | `ui` (UiSettings) | **RUST-ONLY** | Consider keeping |
| - | `keybindings` | **RUST-ONLY** | Consider keeping |

### Fields to Add to Rust (17 new fields)

```rust
// Model & Framework
pub default_model: Option<String>,           // defaultModel
pub agent_framework: Option<String>,         // agentFramework

// Paths
pub python_path: Option<String>,             // pythonPath
pub auto_build_path: Option<String>,         // autoBuildPath

// Feature flags
pub auto_update_auto_build: Option<bool>,    // autoUpdateAutoBuild
pub auto_name_terminals: Option<bool>,       // autoNameTerminals

// Notifications (nested struct)
pub notifications: Option<NotificationSettings>,  // notifications

// Global API Keys (sensitive - consider encryption later)
pub global_claude_oauth_token: Option<String>,    // globalClaudeOAuthToken
pub global_openai_api_key: Option<String>,        // globalOpenAIApiKey
pub global_anthropic_api_key: Option<String>,     // globalAnthropicApiKey
pub global_google_api_key: Option<String>,        // globalGoogleApiKey
pub global_groq_api_key: Option<String>,          // globalGroqApiKey

// Graphiti LLM settings
pub graphiti_llm_provider: Option<String>,        // graphitiLlmProvider
pub ollama_base_url: Option<String>,              // ollamaBaseUrl

// Changelog preferences
pub changelog_format: Option<String>,             // changelogFormat
pub changelog_audience: Option<String>,           // changelogAudience
pub changelog_emoji_level: Option<String>,        // changelogEmojiLevel
```

### New Struct: NotificationSettings

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettings {
    #[serde(default)]
    pub on_task_complete: bool,
    #[serde(default)]
    pub on_task_failed: bool,
    #[serde(default)]
    pub on_review_needed: bool,
    #[serde(default)]
    pub sound: bool,
}
```

## Scope

### In Scope
- Add 17 missing fields to Rust `AppSettings` struct
- Add `NotificationSettings` struct to Rust
- Update `Default` impl for `AppSettings`
- Update TypeScript types if needed for consistency
- Test settings save/load round-trip

### Out of Scope
- Removing existing Rust-only fields (editor, max_agents, api, ui, keybindings)
- API key encryption (future enhancement)
- UI changes

## Implementation Phases

### Phase 1: Add NotificationSettings Struct
**Objective**: Create the nested struct for notifications

**File to Modify**:
- `/Users/aiml/Projects/forge/forge-project/crates/forge-tauri/src/ipc/types.rs`

**Steps**:
1. Add `NotificationSettings` struct after `UiSettings`
2. Add serde attributes with camelCase renaming

**Code**:
```rust
/// Notification preferences.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettings {
    /// Notify on task completion.
    #[serde(default)]
    pub on_task_complete: bool,
    /// Notify on task failure.
    #[serde(default)]
    pub on_task_failed: bool,
    /// Notify when review is needed.
    #[serde(default)]
    pub on_review_needed: bool,
    /// Play sound with notifications.
    #[serde(default)]
    pub sound: bool,
}
```

**Verification**:
- [ ] Struct compiles without errors

### Phase 2: Extend AppSettings Struct
**Objective**: Add all 17 missing fields

**File to Modify**:
- `/Users/aiml/Projects/forge/forge-project/crates/forge-tauri/src/ipc/types.rs`

**Steps**:
1. Add fields to `AppSettings` struct with proper serde attributes
2. All new fields should be `Option<T>` with `#[serde(default)]`
3. Use `#[serde(rename = "camelCase")]` for each field

**Verification**:
- [ ] Struct compiles without errors
- [ ] All field names match TypeScript exactly (camelCase in JSON)

### Phase 3: Update Default Implementation
**Objective**: Provide sensible defaults for new fields

**File to Modify**:
- `/Users/aiml/Projects/forge/forge-project/crates/forge-tauri/src/ipc/types.rs`

**Steps**:
1. Update `impl Default for AppSettings` to include all new fields
2. Set reasonable defaults (mostly `None` for optional fields)

**Code addition to Default impl**:
```rust
// New fields - all optional, default to None
default_model: None,
agent_framework: None,
python_path: None,
auto_build_path: None,
auto_update_auto_build: None,
auto_name_terminals: None,
notifications: Some(NotificationSettings::default()),
global_claude_oauth_token: None,
global_openai_api_key: None,
global_anthropic_api_key: None,
global_google_api_key: None,
global_groq_api_key: None,
graphiti_llm_provider: None,
ollama_base_url: None,
changelog_format: None,
changelog_audience: None,
changelog_emoji_level: None,
```

**Verification**:
- [ ] `cargo build -p forge-tauri` succeeds
- [ ] `cargo test -p forge-tauri` passes

### Phase 4: Rebuild and Test
**Objective**: Verify the changes work end-to-end

**Steps**:
1. Run `cargo build -p forge-tauri`
2. Restart the Tauri app
3. Complete the onboarding wizard
4. Close and reopen app - wizard should NOT appear
5. Add a Claude profile - should work and persist

**Verification**:
- [ ] Build succeeds
- [ ] Onboarding state persists across app restart
- [ ] Claude profile Add button works
- [ ] Settings round-trip correctly (save then load)

## File Changes Summary

**Modified Files**:
1. `/Users/aiml/Projects/forge/forge-project/crates/forge-tauri/src/ipc/types.rs`
   - Add `NotificationSettings` struct (~15 lines)
   - Add 17 fields to `AppSettings` struct (~40 lines)
   - Update `Default` impl (~20 lines)

**No New Files Created**

## Testing Strategy

**Manual Tests**:
1. Fresh install test (delete ~/.forge/settings.json)
2. Complete onboarding, restart, verify no wizard
3. Add Claude profile, restart, verify profile persists
4. Change settings, restart, verify all settings persist

**Automated Tests**:
- Add test for AppSettings serialization round-trip
- Add test for NotificationSettings default values

## Rollback Plan

If issues occur:
1. Revert changes to types.rs
2. The settings file format is backward compatible (new fields are optional)
3. Existing settings files will still load (missing fields get defaults)

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing settings | Low | Medium | All new fields are Optional with defaults |
| API key exposure in logs | Medium | High | Don't log sensitive fields, add skip_serializing |
| Type mismatch with frontend | Low | Medium | Test serialization carefully |

## Open Questions

1. **Should API keys have `#[serde(skip_serializing)]`?**
   - Prevents accidental logging but makes debugging harder
   - Recommendation: Yes, add for security

2. **Should we keep the Rust-only fields (editor, max_agents, etc.)?**
   - They're not used by frontend but may be used elsewhere
   - Recommendation: Keep them, they don't hurt anything

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
