# 12 — Operational Policy

## Runtime config

Recommended config shape is in `schemas/puntax-config.example.json`.

Key toggles:

```text
PUNTAX_CONTEXT_ROUTER_ENABLED
PUNTAX_EVENT_LEDGER_ENABLED
PUNTAX_PRECOMPACT_MODE
PUNTAX_LLM_DISTILLATION_ENABLED
PUNTAX_PERMISSION_GOVERNOR_ENABLED
PUNTAX_CODE_MAP_ENABLED
```

## Default budgets

```text
prompt:       300 tokens
pre_edit:    1200 tokens
resume:      1500 tokens
debug:       2000 tokens
review:      3000 tokens
architecture:3000 tokens
```

## Storage retention

```text
events:       30–90 days project-local, longer if compacted
checkpoints:  90 days or last 50 per project
memories:     by kind/expiration policy
logs:         keep existing rolling log retention initially
cache:        safe to delete anytime
```

## Security posture

- Treat memory files as untrusted input.
- Validate JSON before using it.
- Strip control characters from injected context.
- Do not store secrets.
- Do not include full tool outputs in durable memory.
- Do not allow memory to modify permission policy directly.
- Do not read/write outside project without explicit permission.

## Context poisoning defenses

- Every memory entry has provenance.
- LLM-distilled memory has lower confidence.
- Prompt injection-like instructions inside docs/memory are quoted as data, not followed as policy.
- User-confirmed memory outranks inferred memory.
- Source/tests/diagnostics outrank memory.

## Failure policy

Non-permission hooks should fail open:

```text
context router fails -> inject nothing
index fails -> fallback to existing tools
memory parse fails -> skip corrupted entry
precompact reducer fails -> log and continue
```

Permission failures should fail closed for risky operations:

```text
permission governor fails + action risky -> ask/escalate
permission governor fails + action known-safe -> cf-approve fallback
```

## Maintenance commands

Recommended future commands:

```text
/puntax status
/puntax checkpoint
/puntax memory search <query>
/puntax memory prune
/puntax permissions review
/puntax index refresh
/puntax distill
```

