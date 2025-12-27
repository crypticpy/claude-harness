# APH Purchase App - House Cleaning Plan

## Overview
Clean up the repository by handling stale branches, Dependabot updates, and minor housekeeping tasks to get the codebase in good shape for future development.

---

## Phase 1: Git Branch Cleanup

### 1.1 Delete Stale Feature Branch
- **Branch**: `origin/purchase_req_submit_patch`
- **Action**: Delete (identical to main, already merged)
- **Command**: `git push origin --delete purchase_req_submit_patch`

### 1.2 Review Dependabot Branches (14 total)

**GitHub Actions Updates** (generally safe):
| Branch | Update | Risk |
|--------|--------|------|
| `dependabot/github_actions/actions/checkout-6` | checkout v6 | Low |
| `dependabot/github_actions/actions/labeler-6` | labeler v6 | Low |
| `dependabot/github_actions/actions/setup-node-6` | setup-node v6 | Low |

**Backend npm Updates**:
| Branch | Update | Risk |
|--------|--------|------|
| `dependabot/npm_and_yarn/backend/cross-env-10.1.0` | cross-env | Low |
| `dependabot/npm_and_yarn/backend/prettier-3.7.3` | prettier | Low |
| `dependabot/npm_and_yarn/backend/tsx-4.21.0` | tsx | Low |
| `dependabot/npm_and_yarn/backend/typescript-eslint/eslint-plugin-8.48.1` | eslint-plugin | Medium |
| `dependabot/npm_and_yarn/backend/multi-6d7db9f379` | Multiple deps | Review |

**Frontend npm Updates**:
| Branch | Update | Risk |
|--------|--------|------|
| `dependabot/npm_and_yarn/frontend/eslint-9.39.1` | eslint | Medium |
| `dependabot/npm_and_yarn/frontend/jsdom-27.2.0` | jsdom | Low |
| `dependabot/npm_and_yarn/frontend/tanstack/react-query-5.90.11` | react-query | Medium |
| `dependabot/npm_and_yarn/frontend/uuid-13.0.0` | uuid | Low |
| `dependabot/npm_and_yarn/frontend/multi-5bd58450ad` | Multiple deps | Review |

**Strategy**:
1. Check GitHub for associated PRs
2. For each PR: review changes, check CI status
3. Merge low-risk updates that pass CI
4. Close PRs for breaking/unnecessary updates
5. Delete branches after PR resolution

---

## Phase 2: Security & Housekeeping

### 2.1 Security Fix - cookies.txt
- **Issue**: JWT tokens committed to repository
- **Files**: `/cookies.txt`
- **Action**:
  1. Add `cookies.txt` to `.gitignore`
  2. Remove from git tracking: `git rm --cached cookies.txt`
  3. Commit the .gitignore change

### 2.2 Remove Stray Files
- **File**: `/0` (empty file, 0 bytes)
- **Action**: Delete

### 2.3 Clean Backup Files (Optional)
- `/frontend/apps/web/src/stories/base/StyledDataGrid.stories.tsx.bak`
- `/backend/.env.bak`
- **Action**: Review and delete if not needed

### 2.4 Add Frontend Environment Template (Optional)
- **Missing**: `/frontend/.env.example`
- **Action**: Create template based on required env vars

---

## Phase 3: Docker Verification

### Current State (Already Good)
- Base image: `node:20-alpine` (already Alpine!)
- Multi-stage builds: Implemented
- Security: Non-root user, dumb-init
- Healthchecks: Present in production compose

### Action Items
- **Verify with partner**: Confirm if additional changes are needed
- **Files to review if changes needed**:
  - `/backend/Dockerfile`
  - `/frontend/Dockerfile`
  - `/docker-compose.prod.yml`

---

## Execution Order

1. **Security first**: Fix cookies.txt exposure
2. **Branch cleanup**: Delete stale feature branch
3. **Dependabot triage**: Review PRs on GitHub, merge safe ones
4. **Housekeeping**: Remove stray files, clean backups
5. **Docker**: Coordinate with partner on any additional changes
6. **Commit**: Single cleanup commit for housekeeping items

---

## Files to Modify

| File | Action |
|------|--------|
| `.gitignore` | Add cookies.txt |
| `cookies.txt` | Remove from git tracking |
| `/0` | Delete |
| `*.bak` files | Delete (optional) |

---

## Commands Reference

```bash
# Delete stale feature branch
git push origin --delete purchase_req_submit_patch

# Fix cookies.txt security issue
echo "cookies.txt" >> .gitignore
git rm --cached cookies.txt

# Delete stray file
rm ./0

# Check GitHub PRs for Dependabot
gh pr list --state open --author "app/dependabot"
```

---

## Notes

- Codebase is healthy overall (only 3 TODOs, all properly scoped)
- CI/CD is well-configured with commitlint, tests, and builds
- 56 test files provide good coverage
- Documentation is comprehensive
