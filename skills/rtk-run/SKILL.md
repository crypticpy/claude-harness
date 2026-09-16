---
name: rtk-run
description: Compress verbose CLI output with rtk before returning results. Activates for git, cargo, npm, docker, go, grep, ls, and other supported commands.
---

# rtk — Rust Token Killer

rtk compresses verbose command output so you receive concise, structured results instead of raw terminal dumps.

## Rule

When the rtk Claude hook is installed, run supported commands normally. The PreToolUse hook rewrites matching Bash commands to `rtk <command>` before execution.

If the hook is unavailable, blocked, or not rewriting a supported command, use the manual fallback:

```
rtk <command>
```

**Examples:**

```sh
rtk git status
rtk cargo test
rtk docker ps
rtk ls src/
rtk grep "TODO" .
```

## Important rules

1. **Never double-prefix.** If a command already starts with `rtk`, do not add it again.
2. **Arguments pass through.** Include flags after the rtk subcommand: `rtk cargo test --release -- my_test`.
3. **Fail-safe.** If `rtk` is not installed or not on PATH, run the command without the prefix.
4. **Environment variables.** Place env vars before rtk: `RUST_LOG=debug rtk cargo test`.
5. **Recovery.** If filtered output is unusable, rerun as `rtk proxy <cmd>` or `RTK_DISABLED=1 <cmd>`. Truncated results print their own recovery path (`rtk recall <hash>`).
6. **Do not add redundant pipes** (`| grep`, `| tail`, `| head`) after rtk-prefixed commands — rtk already compresses the output.
7. **Claude built-in Read/Grep/Glob** do not pass through the Bash hook. Use shell `cat`/`rg`/`find` (which the hook can rewrite) or call `rtk read`, `rtk grep`, `rtk find` when you want compressed file output.

## Meta commands

```sh
rtk gain              # token savings dashboard
rtk discover          # missed savings from Claude Code history
rtk proxy <cmd>       # run unfiltered, still tracked
rtk rewrite "<cmd>"   # preview how a command would be rewritten
```
