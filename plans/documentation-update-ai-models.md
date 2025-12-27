# Implementation Plan: Update Documentation for Current AI Model Configuration

Created: 2025-12-01
Status: PENDING APPROVAL

## Summary

Update README.md, QUICKSTART.md, and DEPLOYMENT.md to accurately reflect the current AI model configuration. The primary gap is that chat/analysis models (GPT-5 and GPT-4.1 for extended context) are not documented - only the transcription models (Whisper and GPT-4o Transcribe) are mentioned. The documentation also needs to reflect the token-based automatic model selection strategy.

## Scope

### In Scope
- Update AI Models section in README.md to include GPT-5 and GPT-4.1 (gpt-41)
- Update environment variable examples to show AZURE_OPENAI_GPT5_DEPLOYMENT
- Update architecture diagrams to show correct model names
- Update QUICKSTART.md architecture diagram
- Update DEPLOYMENT.md environment variables section
- Ensure consistency across all three documents

### Out of Scope
- Changes to code functionality
- Updates to other documentation files (ENV_SETUP.md, CLAUDE.md, etc.)
- Infrastructure/deployment script changes

## Prerequisites
- None - this is documentation-only

## Implementation Phases

### Phase 1: Update README.md AI Models Section

**Objective**: Document the complete set of AI models used by the application

**Files to Modify**:
- `/Users/aiml/Documents/transcriber_code/meeting-transcriber/README.md`
  - Lines 52-68: AI Models section

**Steps**:

1. Replace the current AI Models section (lines 52-68) with updated content that includes:
   - **Transcription Models**: Whisper-1, GPT-4o Transcribe (current)
   - **Analysis/Chat Models**: GPT-5 (standard), GPT-4.1 (extended context)
   - Token-based automatic selection explanation
   - Environment variable mapping

2. Update the table format to show:
   | Model | Purpose | Context Limit |
   |-------|---------|---------------|
   | whisper-1 | Fast transcription | N/A |
   | gpt-4o-transcribe | Enhanced transcription | N/A |
   | gpt-5 | Analysis & Chat | 256k tokens |
   | gpt-41 (GPT-4.1) | Extended context | 1M tokens |

3. Update Configuration Options section (lines 114-143):
   - Change `AZURE_OPENAI_GPT4_DEPLOYMENT` examples to `AZURE_OPENAI_GPT5_DEPLOYMENT`
   - Add note about legacy GPT4_DEPLOYMENT still being supported
   - Update comment from "gpt-4o" to "gpt-5"

**Verification**:
- [ ] All models documented with correct names
- [ ] Environment variable names match actual code
- [ ] Token limits are accurate (256k standard, 1M extended)

### Phase 2: Update QUICKSTART.md

**Objective**: Update quick start guide with correct model names and architecture

**Files to Modify**:
- `/Users/aiml/Documents/transcriber_code/meeting-transcriber/QUICKSTART.md`
  - Lines 45-51: Azure OpenAI configuration example
  - Lines 128-148: Architecture diagram

**Steps**:

1. Update Azure OpenAI configuration example (lines 45-51):
   - Change `AZURE_OPENAI_GPT4_DEPLOYMENT` to `AZURE_OPENAI_GPT5_DEPLOYMENT`
   - Update comment from "your-gpt4-deployment" to "your-gpt5-deployment"

2. Update Architecture diagram (lines 128-148):
   - Change "gpt-4o" reference to "gpt-5 / gpt-41"
   - Add note about automatic model selection

3. Update "What's Included" section (line 111):
   - Change "GPT-4o" to "GPT-5"

**Verification**:
- [ ] Architecture diagram shows correct models
- [ ] Configuration examples use GPT-5 naming
- [ ] Feature list references correct model

### Phase 3: Update DEPLOYMENT.md

**Objective**: Update deployment documentation with correct environment variables

**Files to Modify**:
- `/Users/aiml/Documents/transcriber_code/meeting-transcriber/DEPLOYMENT.md`
  - Lines 243-261: Environment Variables section

**Steps**:

1. Update Required Variables section (lines 243-251):
   - Change `AZURE_OPENAI_GPT4_DEPLOYMENT` to `AZURE_OPENAI_GPT5_DEPLOYMENT`
   - Update comment from "your-gpt4-deployment" to "your-gpt5-deployment"

2. Update Optional Variables table (lines 253-261):
   - Add `AZURE_OPENAI_GPT4_DEPLOYMENT` as legacy/fallback option
   - Clarify that GPT5 deployment takes precedence

3. Add a brief note explaining:
   - The app supports GPT-5 (standard context, 256k tokens)
   - Optional GPT-4.1 (extended context, 1M tokens) via AZURE_OPENAI_EXTENDED_GPT_DEPLOYMENT
   - Automatic token-based model selection

**Verification**:
- [ ] Environment variable names match code
- [ ] Both standard and extended deployments documented
- [ ] Legacy GPT4 variable mentioned for backward compatibility

## Testing Strategy

- Manual verification by reading updated documentation
- Cross-reference with actual code in:
  - `/Users/aiml/Documents/transcriber_code/meeting-transcriber/lib/token-utils.ts`
  - `/Users/aiml/Documents/transcriber_code/meeting-transcriber/lib/openai.ts`
  - `/Users/aiml/Documents/transcriber_code/meeting-transcriber/lib/validations/config.ts`

## Rollback Plan

- Git revert of documentation commits if needed
- No code changes, so no functional risk

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Incorrect model names | Low | Medium | Verified against actual code |
| Inconsistency between docs | Low | Low | Update all three files together |
| Confusion about legacy variables | Medium | Low | Document both new and legacy variable names |

## Open Questions

1. Should we update ENV_SETUP.md as well for full consistency? (Currently out of scope)
2. Is there a preference for "GPT-4.1" vs "gpt-41" naming in documentation?

## Actual Code References

Based on code verification:

**From `/Users/aiml/Documents/transcriber_code/meeting-transcriber/lib/token-utils.ts`:**
- Line 8-9: "gpt-5 (standard context)" and "gpt-41 (extended context)"
- Line 21-22: TOKEN_LIMITS: standard = 256000, extended = 1000000
- Lines 97-100: Priority chain: AZURE_OPENAI_GPT5_DEPLOYMENT → AZURE_OPENAI_GPT4_DEPLOYMENT → 'gpt-5'

**From `/Users/aiml/Documents/transcriber_code/meeting-transcriber/lib/openai.ts`:**
- Line 269-270: Error message references "AZURE_OPENAI_GPT5_DEPLOYMENT (or legacy AZURE_OPENAI_GPT4_DEPLOYMENT)"
- Line 277: Default fallback is 'gpt-5' for standard OpenAI

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
