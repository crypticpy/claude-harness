# PUNTAX v2 Review Checklist

Use this checklist before merging any PUNTAX v2 change.

## Safety

- [ ] Permission behavior is not weakened.
- [ ] Destructive operations still require explicit approval.
- [ ] LLM output cannot activate permission rules without validation/approval.
- [ ] Hook failures degrade gracefully except explicit permission denials.
- [ ] Cross-project data leakage is prevented.

## Token efficiency

- [ ] The change does not inject large context blocks by default.
- [ ] New MCP responses are compact and budget-aware.
- [ ] Routine paths do not call LLMs.
- [ ] Precompact behavior is deterministic unless thresholds trigger distillation.

## Correctness

- [ ] New persistent data has schema validation or defensive parsing.
- [ ] Index freshness is checked via hashes/mtimes.
- [ ] Stale data is labeled stale or ignored.
- [ ] Tests cover corrupted/missing files.
- [ ] Existing hook routes still load.

## Migration compatibility

- [ ] Existing brain files still work.
- [ ] Existing MCP tools still work or have compatibility aliases.
- [ ] Existing config does not break.
- [ ] New behavior can be disabled or rolled back.

## Tests

- [ ] Unit tests added for reducers/rankers/policy checks.
- [ ] MCP tools have handler-level tests.
- [ ] Hook modules load under Node 20+.
- [ ] No network dependency in tests.

