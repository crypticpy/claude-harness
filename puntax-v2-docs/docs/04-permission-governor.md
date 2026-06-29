# 04 — Permission Governor

## Goal

Preserve the current permission layer and make it more auditable, reusable, and token-efficient. The permission governor must prevent bad actions and reduce repeated permission prompts for safe, recurring actions.

## Current state

`settings.template.json` routes `PermissionRequest` through:

```text
cf-approve permission
```

This should remain available.

## Target flow

```text
PermissionRequest
  -> puntax-permission-gate
       1. normalize request
       2. classify risk
       3. check active allow/deny rules
       4. check candidate rules
       5. call cf-approve fallback if needed
       6. write permission event
       7. optionally accrue candidate rule
```

## Decision types

```text
ALLOW      safe, known, scoped
ASK        unknown or medium risk
DENY       prohibited by policy
ESCALATE   user must explicitly confirm
```

## Rule model

See `schemas/permission-rule.schema.json`.

Important fields:

```text
id
scope: global | project | repo | path
tool
match.commandRegex or match.toolInputPattern
decision: allow | ask | deny | escalate
constraints.cwdInsideProject
constraints.networkAllowed
constraints.writeOutsideProjectAllowed
constraints.maxRuntimeSeconds
provenance
status: candidate | active | revoked
```

## Auto-accrual

Auto-accrual means creating a **candidate** permission rule from repeated approved behavior. Candidate rules are not active.

Candidate creation conditions:

```text
same normalized command approved at least 3 times
same project scope
no network access
no destructive command tokens
no writes outside project
successful exit status
not involving secrets
not involving git push or publishing
```

Candidate promotion conditions:

```text
user confirms candidate
or deterministic policy marks command as safe built-in
```

## Never auto-approve

The following must never be auto-promoted from repeated use:

```text
rm -rf
sudo
chmod/chown outside project
force push
git push
npm publish / package publishing
cloud deploy commands
secret reads or credential export
database destructive operations
curl/wget piping into shell
arbitrary network exfiltration
writes outside repo
```

## Permission ledger

Every permission decision should be recorded as an event:

```json
{
  "kind": "permission",
  "tool": "Bash",
  "decision": "ask",
  "risk": "medium",
  "reason": "network command not covered by active rule",
  "ruleId": null,
  "commandHash": "..."
}
```

## Separation from memory

Permission rules must not be memory entries. Memory may inform the user or agent, but active permission policy is a separate authority.

LLM output can propose a candidate rule only in a `candidate` state. It must not activate it.

## MCP tools

Optional advanced tools:

```text
permission_explain(requestId)
permission_candidates(projectDir)
permission_promote(candidateId)
permission_revoke(ruleId)
```

Only expose promote/revoke if the harness supports explicit user confirmation.

