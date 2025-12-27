# Implementation Plan: MVP Release Cleanup & Documentation

Created: 2025-11-28
Status: PENDING APPROVAL

## Summary
Prepare the PurchasePro codebase for MVP release by: (1) committing all recent work and syncing with main, (2) cleaning up temporary files and test scripts, (3) removing obsolete documentation, and (4) updating core documentation to reflect current state.

## Current State Analysis

### Git Status
- **Current Branch**: `feature/demo-help-audit` (already merged to main via PR #24)
- **Local Changes**: 135+ modified files, 13 untracked new files
- **Key Finding**: PR #24 was merged, but local working copy has additional uncommitted changes from recent session work (home page cards, requests page stats, paid count wiring)

### Files Requiring Cleanup
1. **Test Automation Scripts** (7 files at root - should be removed):
   - `fill-approval.js`, `fill-contact.js`, `fill-funding.js`
   - `login-admin.js`, `login-manager.js`, `login-script.js`, `send-chat.js`

2. **Sensitive Files** (1 file - MUST be removed):
   - `cookies.txt` - Contains JWT tokens (security risk)

3. **Temp/Backup Files** (3 items):
   - `0` - Empty file at root
   - `backend/.env.bak` - Already marked deleted in git
   - `frontend/apps/web/src/stories/base/StyledDataGrid.stories.tsx.bak` - Already marked deleted

4. **Root-Level Status Docs** (10 files - candidates for removal):
   - `AGENTS.md` - Internal agent instructions
   - `DARK_MODE_AUDIT_REQUEST_APPROVAL.md` - Completed audit
   - `DEMO_CARDS_FIX_SUMMARY.md` - Session summary
   - `DEMO_HELP_AUDIT_REPORT.md` - Session report
   - `SESSION_EXPIRATION_FIX.md` - Fix documentation
   - `SESSION_EXPIRATION_TEST_PLAN.md` - Test plan (completed)
   - `STABILIZATION_REPORT.md` - Status report
   - `UI_UX_AUDIT_REPORT.md` - Audit report
   - `implementation-plan-*.md` (3 files) - Completed plans
   - `help-page-fix-summary.md` - Session summary

5. **Planning Directory** (~100+ files):
   - `/planning/OLD/` - 25+ archived documents (remove)
   - Various phase-specific and feature docs (review for relevance)

## Scope

### In Scope
- Commit recent work (home page cards, requests stats, paid count)
- Create PR for recent changes
- Remove test automation scripts and sensitive files
- Remove completed status/audit documents
- Archive or remove planning docs
- Update README.md, CLAUDE.md, STARTUP_GUIDE.md for MVP
- Clean up stale remote branches

### Out of Scope
- New feature development
- Refactoring existing code
- Database migrations
- Test coverage improvements

## Prerequisites
- Ensure all recent changes are tested and working
- Backup any docs that might be needed for reference

## Implementation Phases

### Phase 1: Commit Recent Work
**Objective**: Capture all uncommitted work from recent sessions

**Steps**:
1. Update local main branch: `git checkout main && git pull`
2. Create new feature branch: `git checkout -b feat/home-page-navigation`
3. Stage and commit recent feature work:
   - Home page card navigation (HomeClient.tsx)
   - Requests page stat cards (requests/Client.tsx)
   - Dashboard hook updates for paidRequests (useDashboard.ts)
4. Stage and commit untracked new files:
   - `autoEscalation.service.ts`
   - Admin approvers components (UserCard, UserDetailPanel, etc.)
   - Delegation components (CreateDelegationModal, DelegationCard, etc.)
   - New stories (FilterSelect, ThemeToggle)
   - `fiscalYear.ts` utility

**Verification**:
- [ ] All feature changes committed
- [ ] No uncommitted changes remain (except cleanup targets)

### Phase 2: Remove Sensitive & Temporary Files
**Objective**: Clean up files that should never be in version control

**Files to Remove** (from git tracking and filesystem):
- `/Users/aiml/Documents/PurchasePro/cookies.txt`
- `/Users/aiml/Documents/PurchasePro/fill-approval.js`
- `/Users/aiml/Documents/PurchasePro/fill-contact.js`
- `/Users/aiml/Documents/PurchasePro/fill-funding.js`
- `/Users/aiml/Documents/PurchasePro/login-admin.js`
- `/Users/aiml/Documents/PurchasePro/login-manager.js`
- `/Users/aiml/Documents/PurchasePro/login-script.js`
- `/Users/aiml/Documents/PurchasePro/send-chat.js`
- `/Users/aiml/Documents/PurchasePro/0`

**Update .gitignore** to prevent future issues:
```
# Test automation scripts
*.cookies.txt
login-*.js
fill-*.js
send-*.js
```

**Verification**:
- [ ] Sensitive files removed from repo
- [ ] .gitignore updated
- [ ] No credentials exposed in commit history (check if files were ever committed)

### Phase 3: Clean Up Status/Audit Documents
**Objective**: Remove completed session documentation that clutters the root

**Files to Remove from Root**:
- `AGENTS.md`
- `DARK_MODE_AUDIT_REQUEST_APPROVAL.md`
- `DEMO_CARDS_FIX_SUMMARY.md`
- `DEMO_HELP_AUDIT_REPORT.md`
- `FRONTEND_BACKEND_INTEGRATION_STATUS.md` (duplicate - also in backend/)
- `SESSION_EXPIRATION_FIX.md`
- `SESSION_EXPIRATION_TEST_PLAN.md`
- `STABILIZATION_REPORT.md`
- `UI_UX_AUDIT_REPORT.md`
- `implementation-plan-demo-cards-fix.md`
- `implementation-plan-help-page-cards.md`
- `implementation-plan-pdf-export.md`
- `help-page-fix-summary.md`

**Verification**:
- [ ] Root directory contains only essential docs (README, CLAUDE.md, STARTUP_GUIDE.md)

### Phase 4: Clean Up Planning Directory
**Objective**: Remove obsolete planning documents, keep valuable reference material

**Action A - Remove Entirely** (`/planning/OLD/` - 25+ files):
- All files in `planning/OLD/` directory

**Action B - Remove Specific Files** (completed/obsolete):
- `API_SPECIFICATIONS_OLD.md`
- Phase-specific reports that are now outdated
- Implementation plans for completed features

**Action C - Keep** (valuable reference):
- `SPEC.md` - Main specification
- `DATA_MODEL.md` - Database reference
- `API_SPECIFICATIONS.md` - Current API docs
- `EXECUTION_ROADMAP.md` - High-level roadmap

**Verification**:
- [ ] Planning directory is clean and organized
- [ ] No outdated phase documentation remains

### Phase 5: Update Core Documentation
**Objective**: Ensure README and key docs reflect current MVP state

**Files to Update**:
- `README.md` - Update features list, remove WIP sections, add current status
- `CLAUDE.md` - Verify accuracy of commands, architecture, patterns
- `STARTUP_GUIDE.md` - Verify setup instructions work

**New Sections to Add to README**:
- Current feature status
- MVP capabilities
- Known limitations

**Verification**:
- [ ] README accurately describes MVP
- [ ] Setup instructions verified
- [ ] No references to incomplete features

### Phase 6: Create PR and Clean Up Branches
**Objective**: Submit cleanup PR and remove stale branches

**PR Creation**:
1. Commit all cleanup changes
2. Create PR with clear summary of changes
3. Ensure CI passes

**Branch Cleanup** (stale local branches to delete):
- `chore/remove-mssql-workflow` (already merged)
- `feat/dark-mode-and-admin-updates` (already merged)
- `refactor/test-suite-overhaul` (already merged)

**Remote Branch Cleanup** (coordinate with team):
- Review old feature branches (Bug_Fixes, Filter_Button_Removal, etc.)
- Remove merged dependabot branches

**Verification**:
- [ ] PR created and approved
- [ ] Stale local branches deleted
- [ ] Main branch is clean and up to date

## Testing Strategy
- Run `npm run preflight` in both backend and frontend after cleanup
- Verify app still builds and runs correctly
- Quick smoke test of main features

## Rollback Plan
- All removals are in git, can be restored with `git checkout <commit> -- <file>`
- Create a backup branch before major deletions: `git branch backup/pre-mvp-cleanup`

## Risks and Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Accidental deletion of needed docs | Low | Medium | Create backup branch first |
| Breaking changes in committed code | Low | High | Run preflight before PR |
| Missing credentials in cookies.txt | Medium | High | Verify file wasn't committed to git history |

## Open Questions
1. Should PRD directory be kept or archived? (Contains detailed requirements)
2. Should planning/reports/ subdirectory be preserved for audit trail?
3. Any specific documentation updates needed for deployment guide?

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
