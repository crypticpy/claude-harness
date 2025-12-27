# Implementation Plan: ai_review_runner.py

## Overview

Create a production-ready Python runner for the AI Review (Senior Engineer Review) phase that runs before auto-merge. This runner is spawned by Electron as a subprocess and outputs structured JSON markers for the UI to parse.

## Context Summary

**Pattern Reference**: `merge_runner.py` - 695 lines, uses:
- Windows encoding handling (lines 29-54)
- Lazy-loading for expensive imports
- Dataclass for progress state
- Enum for status phases
- Async run() pattern with phased execution
- JSON output markers for IPC

**IPC Handler**: `ai-review-handlers.ts` (lines 200-240) expects:
```
__AI_REVIEW_PROGRESS__:{"status": "starting|checking|analyzing|reviewing", "message": "..."}
__AI_REVIEW_COMPLETE__:{"issues": []}       # Empty = approved
__AI_REVIEW_FAILED__:{"issues": ["..."]}    # Non-empty = rejected
```

**CLI Arguments** (lines 159-164):
- `--project-dir` - Path to the project
- `--spec` - Spec ID to review
- `--model` - Claude model to use (default: opus)

## Implementation Design

### File Structure

```
/auto-claude/runners/ai_review_runner.py  (~350 lines, well under 500)
```

### Architecture

```
AIReviewRunner
    |
    +-- Phase 1: Subtask Completion Check
    |       - Read implementation_plan.json
    |       - Verify all subtasks completed/skipped with valid reasons
    |       - Flag failed/pending subtasks
    |
    +-- Phase 2: QA Report Analysis
    |       - Read qa_report.md if exists
    |       - Check for REJECTED/FAILED markers
    |       - Parse test results if present
    |
    +-- Phase 3: Merge Readiness Check
    |       - Check git status for uncommitted changes
    |       - Check for merge conflicts with base branch
    |
    +-- Phase 4: AI Holistic Review (Optional)
            - Use Claude SDK to review code changes
            - Summarize what was built
            - Flag any concerns
```

### Data Classes

```python
class ReviewStatus(str, Enum):
    """Status phases for the review pipeline."""
    STARTING = "starting"
    CHECKING = "checking"      # Subtask completion
    ANALYZING = "analyzing"    # QA report
    REVIEWING = "reviewing"    # Git & AI review
    COMPLETED = "completed"
    FAILED = "failed"

@dataclass
class ReviewProgress:
    """Progress state for the review pipeline."""
    status: ReviewStatus
    message: str
    spec_name: str = ""
    project_dir: str = ""
    subtasks_total: int = 0
    subtasks_completed: int = 0
    subtasks_failed: int = 0
    subtasks_pending: int = 0
    issues: list[str] = field(default_factory=list)
    phase_start_time: str = ""

@dataclass
class ReviewResult:
    """Final review result."""
    approved: bool
    issues: list[str]
    summary: str = ""
```

### Key Functions

1. **emit_progress(progress: ReviewProgress)** - Output `__AI_REVIEW_PROGRESS__` marker
2. **emit_complete(issues: list[str])** - Output `__AI_REVIEW_COMPLETE__` if empty, else `__AI_REVIEW_FAILED__`
3. **check_subtask_completion()** - Parse implementation_plan.json, return issues
4. **check_qa_report()** - Parse qa_report.md, return issues
5. **check_merge_readiness()** - Git status checks, return issues
6. **run_ai_review()** (optional) - Use Claude SDK for holistic review

### Validation Logic

**Subtask Completion Checks:**
- All subtasks must be `completed` or `skipped` (with valid skip_reason)
- `failed` or `pending` subtasks are flagged as issues
- Check `phases[].subtasks[].status` in implementation_plan.json

**QA Report Checks:**
- Look for `REJECTED` or `FAILED` in qa_report.md content
- Check `qa_signoff.status` in implementation_plan.json
- Flag if qa_signoff.status != "approved"

**Merge Readiness Checks:**
- `git status --porcelain` should be empty (no uncommitted changes)
- `git merge-base --is-ancestor` to check for conflicts

### Error Handling

- All file reads wrapped in try/except
- Missing files produce warnings, not failures
- Git command failures produce descriptive errors
- Process exits with code 0 (success) or 1 (failure)

## Implementation Checklist

- [ ] Windows encoding setup (copy from merge_runner.py)
- [ ] Path setup and .env loading
- [ ] Output markers constants
- [ ] ReviewStatus enum
- [ ] ReviewProgress dataclass
- [ ] ReviewResult dataclass
- [ ] emit_progress() function
- [ ] emit_complete() function
- [ ] AIReviewRunner class
  - [ ] __init__() with lazy-loading
  - [ ] update_progress() method
  - [ ] _check_subtask_completion() async method
  - [ ] _check_qa_report() async method
  - [ ] _check_merge_readiness() async method
  - [ ] run() async method orchestrating all phases
- [ ] parse_args() function
- [ ] main_async() function
- [ ] main() entry point with error handling

## Quality Standards

- Type hints on all functions and methods
- Docstrings for classes and public methods
- Follow existing patterns from merge_runner.py
- Self-documenting variable names
- Proper error messages with context
- No unnecessary complexity

## Output Format Examples

**Progress Updates:**
```json
__AI_REVIEW_PROGRESS__:{"status":"checking","message":"Checking subtask completion (5/8 complete)..."}
__AI_REVIEW_PROGRESS__:{"status":"analyzing","message":"Analyzing QA report..."}
__AI_REVIEW_PROGRESS__:{"status":"reviewing","message":"Checking merge readiness..."}
```

**Success (Approved):**
```json
__AI_REVIEW_COMPLETE__:{"issues":[]}
```

**Failure (Rejected):**
```json
__AI_REVIEW_FAILED__:{"issues":["3 subtasks are still pending","QA report shows REJECTED status","Uncommitted changes in worktree"]}
```
