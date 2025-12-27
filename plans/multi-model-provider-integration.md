# Implementation Plan: Multi-Model Provider Integration (GLM 4.7 & Minimax M2.1)

Created: 2025-12-22
Status: PENDING APPROVAL

## Summary

Integrate GLM 4.7 (Z.AI) and Minimax M2.1 as alternative model providers for Auto-Claude agents. Both providers offer **Anthropic-compatible APIs**, allowing them to plug into the existing Claude Code SDK infrastructure by configuring custom `ANTHROPIC_BASE_URL` endpoints. The implementation will support using Opus for orchestrator/primary agents while allowing subagents to use GLM or Minimax models.

## Key Insight from Documentation

Both Z.AI and Minimax provide **drop-in Anthropic-compatible APIs**:
- **Minimax**: `https://api.minimax.io/anthropic` (model: `MiniMax-M2.1`)
- **Z.AI**: `https://api.z.ai/api/anthropic` (model: `GLM-4.7`)

This means the existing `ANTHROPIC_BASE_URL` passthrough in `core/auth.py` can route requests to these providers with minimal changes.

## Scope

### In Scope
- Add GLM 4.7 and Minimax M2.1 to the model selection system
- Create provider configuration for routing API calls to the correct endpoints
- Add API key settings to UI and environment configuration
- Enable per-agent/per-subagent model selection
- Allow swapping alternative models into primary/orchestrator positions

### Out of Scope
- Graphiti memory system integration (already has its own multi-provider system)
- Cost estimation for alternative models
- Vision/multimodal features (Minimax doesn't support images via Anthropic API)
- MCP server integration for these providers

## Prerequisites
- API keys for both providers (user will provide)
- Understanding that both providers use Anthropic-compatible APIs

## Implementation Phases

### Phase 1: Provider Configuration System
**Objective**: Create a provider abstraction that routes model requests to the correct API endpoint

**Files to Modify**:
- `auto-claude/core/auth.py` - Add provider-specific environment variable handling
- `auto-claude/phase_config.py` - Extend MODEL_ID_MAP with new models and provider metadata

**New Files to Create**:
- `auto-claude/core/providers.py` - Provider configuration and routing logic

**Steps**:
1. Create `providers.py` with provider definitions:
   ```python
   PROVIDERS = {
       "anthropic": {
           "base_url": None,  # Uses default
           "auth_env": "CLAUDE_CODE_OAUTH_TOKEN",
           "models": ["claude-opus-4-5-20251101", "claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"]
       },
       "zai": {
           "base_url": "https://api.z.ai/api/anthropic",
           "auth_env": "ZAI_API_KEY",
           "models": ["glm-4.7", "glm-4.5-air"]
       },
       "minimax": {
           "base_url": "https://api.minimax.io/anthropic",
           "auth_env": "MINIMAX_API_KEY",
           "models": ["MiniMax-M2.1", "MiniMax-M2.1-lightning"]
       }
   }
   ```

2. Add function `get_provider_for_model(model: str)` to detect provider from model ID

3. Add function `get_provider_env_vars(model: str)` that returns the correct `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` for the given model's provider

4. Update `MODEL_ID_MAP` in `phase_config.py`:
   ```python
   MODEL_ID_MAP = {
       # Anthropic (default)
       "opus": "claude-opus-4-5-20251101",
       "sonnet": "claude-sonnet-4-5-20250929",
       "haiku": "claude-haiku-4-5-20251001",
       # Z.AI
       "glm": "glm-4.7",
       "glm-air": "glm-4.5-air",
       # Minimax
       "minimax": "MiniMax-M2.1",
       "minimax-lightning": "MiniMax-M2.1-lightning",
   }
   ```

**Verification**:
- [ ] Unit test: `get_provider_for_model("glm-4.7")` returns `"zai"`
- [ ] Unit test: `get_provider_env_vars("MiniMax-M2.1")` returns correct base_url and auth token

### Phase 2: Client Creation Integration
**Objective**: Modify client creation to use provider-specific environment variables

**Files to Modify**:
- `auto-claude/core/client.py` - Update `create_client()` to use provider routing
- `auto-claude/core/auth.py` - Add new provider API keys to SDK_ENV_VARS

**Steps**:
1. Update `SDK_ENV_VARS` in `auth.py` to include new provider keys:
   ```python
   SDK_ENV_VARS = [
       "ANTHROPIC_BASE_URL",
       "ANTHROPIC_AUTH_TOKEN",
       "ZAI_API_KEY",
       "MINIMAX_API_KEY",
       # ... existing vars
   ]
   ```

2. Update `get_sdk_env_vars()` to accept optional model parameter:
   ```python
   def get_sdk_env_vars(model: str | None = None) -> dict[str, str]:
       """Get environment variables to pass to SDK, routing to correct provider."""
       if model:
           return get_provider_env_vars(model)
       # Fall back to existing behavior
       ...
   ```

3. Update `create_client()` to pass model to `get_sdk_env_vars()`:
   ```python
   def create_client(..., model: str, ...):
       ...
       env = get_sdk_env_vars(model)
       ...
   ```

**Verification**:
- [ ] Creating client with `model="glm-4.7"` sets `ANTHROPIC_BASE_URL` to Z.AI endpoint
- [ ] Creating client with `model="MiniMax-M2.1"` sets `ANTHROPIC_BASE_URL` to Minimax endpoint
- [ ] Default Claude models still work without changes

### Phase 3: Subagent Model Configuration
**Objective**: Allow different models for primary vs subagents

**Files to Modify**:
- `auto-claude/agents/handle.py` - Add provider field to AgentConfig
- `auto-claude/agents/pool.py` - Pass model-specific env to subagent clients
- `auto-claude/phase_config.py` - Add subagent model configuration

**Steps**:
1. Add subagent model configuration to `phase_config.py`:
   ```python
   DEFAULT_SUBAGENT_MODELS = {
       "coder": "sonnet",  # Can be overridden to "glm" or "minimax"
   }

   def get_subagent_model(spec_dir: Path, parent_model: str) -> str:
       """Get model for spawned subagent."""
       # Read from task_metadata.json or use default
       ...
   ```

2. Update `AgentConfig` in `handle.py` to include provider hint:
   ```python
   @dataclass
   class AgentConfig:
       model: str = "claude-sonnet-4-20250514"
       provider: str | None = None  # "anthropic", "zai", "minimax" - auto-detected if None
   ```

3. Update `_default_agent_runner()` in `pool.py` to pass correct env vars based on subagent model

**Verification**:
- [ ] Primary agent using Opus can spawn subagent using GLM 4.7
- [ ] Subagent model configurable via task_metadata.json

### Phase 4: Environment & Settings
**Objective**: Add API key configuration to .env and UI

**Files to Modify**:
- `auto-claude/.env.example` - Document new provider environment variables
- `auto-claude-ui/src/shared/types/settings.ts` - Add new API key fields
- `auto-claude-ui/src/renderer/components/settings/IntegrationSettings.tsx` - Add UI for keys

**Steps**:
1. Add to `.env.example`:
   ```bash
   # =============================================================================
   # ALTERNATIVE MODEL PROVIDERS (OPTIONAL)
   # =============================================================================
   # Z.AI (GLM 4.7) - Anthropic-compatible API
   # Get API key from: https://z.ai/model-api
   # ZAI_API_KEY=your-zai-api-key

   # Minimax (M2.1) - Anthropic-compatible API
   # Get API key from: https://platform.minimax.io/user-center/basic-information/interface-key
   # MINIMAX_API_KEY=your-minimax-api-key
   ```

2. Add to `AppSettings` interface:
   ```typescript
   export interface AppSettings {
     // ... existing fields
     globalZaiApiKey?: string;
     globalMinimaxApiKey?: string;
     // Subagent model provider preference
     subagentProvider?: 'anthropic' | 'zai' | 'minimax';
   }
   ```

3. Add UI fields in IntegrationSettings for new API keys

4. Add to `ModelTypeShort` type:
   ```typescript
   export type ModelTypeShort = 'haiku' | 'sonnet' | 'opus' | 'glm' | 'glm-air' | 'minimax' | 'minimax-lightning';
   ```

**Verification**:
- [ ] API keys visible in Settings > Integrations
- [ ] Keys saved to settings.json correctly
- [ ] Keys passed to Python backend via environment

### Phase 5: CLI & Runtime Integration
**Objective**: Enable model selection via CLI and runtime configuration

**Files to Modify**:
- `auto-claude/cli/main.py` - Accept alternative model names
- `auto-claude/cli/utils.py` - Update model validation

**Steps**:
1. Update CLI help to list available models:
   ```python
   AVAILABLE_MODELS = [
       "opus", "sonnet", "haiku",           # Anthropic
       "glm", "glm-air",                    # Z.AI
       "minimax", "minimax-lightning",      # Minimax
   ]
   ```

2. Add `--subagent-model` CLI argument:
   ```python
   parser.add_argument(
       "--subagent-model",
       type=str,
       choices=AVAILABLE_MODELS,
       default=None,
       help="Model to use for spawned subagents (default: same as primary)"
   )
   ```

3. Pass subagent model through to agent configuration

**Verification**:
- [ ] `python run.py --spec 001 --model opus --subagent-model glm` works
- [ ] Model validation rejects invalid model names

### Phase 6: Documentation & Testing
**Objective**: Document the feature and add tests

**Files to Modify**:
- `CLAUDE.md` - Document new provider options
- `README.md` (if needed) - Add provider setup instructions

**New Files to Create**:
- `tests/test_providers.py` - Unit tests for provider routing

**Steps**:
1. Add provider documentation to CLAUDE.md
2. Create unit tests for:
   - Provider detection from model ID
   - Environment variable routing
   - Model ID resolution for new providers
3. Add integration test verifying subagent can use different provider than primary

**Verification**:
- [ ] All new tests pass
- [ ] Documentation accurately describes setup

## Testing Strategy

### Unit Tests
- `test_providers.py::test_get_provider_for_model` - Provider detection
- `test_providers.py::test_get_provider_env_vars` - Env var generation
- `test_phase_config.py::test_resolve_model_id_alternative_providers` - Model resolution

### Integration Tests
- Create spec with primary=opus, subagent=glm, verify both clients configured correctly
- Test API key validation for missing provider keys

### Manual Testing
1. Set up Z.AI API key, run build with `--model glm`
2. Set up Minimax API key, run build with `--model minimax`
3. Test mixed configuration: `--model opus --subagent-model minimax`

## Rollback Plan

1. Remove new provider environment variables from `.env`
2. Revert `MODEL_ID_MAP` changes in `phase_config.py`
3. Remove `providers.py` if created
4. Revert client.py changes to use default `get_sdk_env_vars()`

The changes are additive and backward-compatible - existing Anthropic-only configurations will continue to work.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Provider API incompatibility | Low | High | Both claim Anthropic-compatible APIs; test early with simple calls |
| Temperature range differences (Minimax: 0.0-1.0 only) | Medium | Low | Clamp temperature values in provider config |
| Missing tool support | Low | Medium | Document which tools work; fall back to Anthropic for unsupported features |
| Rate limiting differences | Medium | Low | Add provider-specific timeout configuration |
| Auth token format differences | Low | Medium | Validate API keys on startup |

## Open Questions

1. **Should we support per-phase provider selection?** (e.g., planning=opus, coding=glm)
   - Current plan: Only primary vs subagent distinction
   - Could extend PhaseModelConfig to support providers per phase

2. **Should we add a "provider test" command?**
   - e.g., `python run.py --test-provider zai` to verify API key works

3. **What should happen if subagent provider fails?**
   - Fail the task? Fall back to primary provider? Make configurable?

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
