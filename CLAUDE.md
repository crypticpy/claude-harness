### Context Management Strategy

**Central AI should conserve context to extend pre-compaction capacity**:

- Delegate file explorations and low-lift tasks to sub-agents
- Always set the sub agent model to Opus!
- Reserve context for coordination, user communication, and strategic decisions
- For straightforward tasks with clear scope: skip master-orchestrator, invoke sub-agent directly

**Sub-agents should maximize context collection**:

- Sub-agent context windows are temporary—after execution, unused capacity = wasted opportunity
- Instruct sub-agents to read all relevant files, load skills, and gather examples before beginning execution
- Sub-agent over-collection is safe; under-collection causes failures

## Operational Protocols

### Agent Coordination

**Parallel** (REQUIRED when applicable):

- Multiple Task tool invocations in single message
- Independent tasks execute simultaneously
- Bash commands run in parallel

**Sequential** (ENFORCE for dependencies):

- Database → API → Frontend
- Research → Planning → Implementation
- Implementation → Testing → Security

### Effective Sub-Agent Usage

**Always use Opus model for sub-agents** - Set `subagent_type` to use the Opus model for maximum capability.

**Maximize Parallelization**:

- Identify independent workstreams that can execute simultaneously
- Launch multiple sub-agents in parallel when tasks don't share file dependencies
- Structure work to minimize sequential bottlenecks

**Prevent File Conflicts**:

- Before parallel dispatch, map which files each sub-agent will modify
- Never assign the same file to multiple parallel sub-agents
- When overlap is unavoidable, sequence those tasks or consolidate into one agent

**Clear Task Scoping**:

- Each sub-agent should have a well-defined, bounded objective
- Provide explicit inputs, expected outputs, and success criteria
- Include relevant file paths and context the sub-agent needs upfront
- Specify what files the sub-agent "owns" exclusively

**Sub-Agent Instructions Should Include**:

1. **Objective**: Clear statement of what to accomplish
2. **File Ownership**: Which files this agent can create/modify
3. **Context**: Relevant background, related files to read first
4. **Constraints**: What NOT to do, boundaries to respect
5. **Output**: What to report back, artifacts to produce

**Sub-Agent Best Practices**:

- Instruct sub-agents to load relevant skills before executing
- Sub-agents should gather full context before making changes (read > act)
- Sub-agents should validate their work before reporting completion
- For complex tasks, have sub-agents create checkpoints/summaries

**Coordination Patterns**:

- **Fan-out**: Dispatch multiple sub-agents for independent tasks, aggregate results
- **Pipeline**: Chain sub-agents where output of one feeds into next
- **Specialist**: Route to domain-specific agents (frontend, backend, testing)
- **Review**: Use `final-review-completeness` and `principal-code-reviewer` agents at deliverable boundaries

**Parallelization is OPT-IN, not opt-out. Default is sequential.**

## Coding Best Practices

**Priority Order** (when trade-offs arise): Correctness > Maintainability > Performance > Brevity

1. **Task Complexity Assessment**: Before starting, classify: **Trivial** (single file, obvious fix) → execute directly. **Moderate** (2-5 files, clear scope) → brief planning then execute. **Complex** (architectural impact, ambiguous requirements) → full research and planning phase first. Match effort to complexity—don't over-engineer trivial tasks or under-plan complex ones.

2. **Integration & Dependency Management**: Before modifying any feature, identify all downstream consumers using codebase search, validate changes against all consumers, and test integration points to prevent breakage from data format or API contract changes.

3. **Code Quality Self-Checks**: Before finalizing code, verify all inputs have validation, parameterized queries are used, authentication/authorization checks exist, and all external calls have error handling with meaningful messages. For state updates with dependent values, verify conditional reset logic doesn't overwrite explicit updates. Normalize dynamic content types (CMS fields, API responses) before use.

4. **Incremental Development**: Implement in atomic tasks with ≤5 files, testing each increment before proceeding, and commit frequently with clear messages describing changes.

5. **Context & Pattern Consistency**: Review relevant files and existing implementations before coding, match established naming conventions and architectural approaches, and ask clarifying questions for ambiguous requirements. Verify import paths against 3+ existing codebase examples before using—never assume paths.

6. **Error Handling & Security**: Handle errors at function entry with guard clauses and early returns, validate and sanitize all user inputs at system boundaries, use parameterized queries to prevent SQL injection, and verify both authentication and authorization before sensitive operations. After any security header or CSP changes, manually test all third-party integrations—they may silently break. For destructive operations (delete, drop, force push), explicitly state the risk and scope before executing.

7. **Documentation**: Document critical decisions and non-obvious reasoning (not what code does), and keep README, API docs, and architecture decision records synchronized with code changes.

8. **Refactoring Safety**: Before refactoring, run tests to establish baseline and identify all usages; refactor incrementally with frequent test runs and commits; for breaking changes, add new interface alongside old, migrate consumers, then remove old interface. After folder or file renames, verify all internal references are updated—self-referencing paths within renamed folders often break.

9. **Self-Correction**: Fix syntax errors, typos, and obvious mistakes immediately without asking permission. For low-level errors discovered during execution, correct and continue—don't stop to report every minor fix.

---

## Error Handling

- Incomplete tasks → Resume from checkpoint
- Agent failure → Reassign to specialist
- **Recovery**: Sessions resume from last documented state

---

## Performance Requirements

- Use ripgrep (rg) over grep/find (5-10x faster)
- Complex tasks require comprehensive research
- Parallel execution when tasks independent

## Git & Quality

- Never push without permission, never force push
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
- Always check `git status` before committing

**Quality Gates**: Enforce checks from Coding Best Practices #3 and #6 (input validation, parameterized queries, auth/authz, no hardcoded secrets).

## Verification Protocol

Three-tier verification is enforced for all significant work:

**Tier 1 — Edit Self-Check**: After turns with significant file changes, a verification prompt is injected automatically. Review it honestly — don't dismiss it as noise. If it flags a concern, address it before moving on.

**Tier 2 — Phase Gates**: When executing a plan, run both `final-review-completeness` and `principal-code-reviewer` agents at the end of each phase. Do not proceed to the next phase until critical issues are resolved.

**Tier 3 — Completion Review**: Before reporting any significant work as complete, run `/freview`. Present the results to the user. All critical and high findings must be addressed.

These verification gates exist because stubs get forgotten, scope creeps silently, and "I'll fix it later" becomes "it shipped broken." The cost of a 2-minute review is always less than the cost of a missed bug.

When planning, no need to estimate completion times—just lay out tasks and actions.
