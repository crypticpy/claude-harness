---
name: rtk-discover
description: Find missed token savings in Claude Code sessions and identify commands that would benefit from rtk filtering.
user_invocable: true
---

# rtk discover — Find Missed Token Savings

Run `rtk discover` in the project directory to scan recent Claude Code sessions for commands that ran without rtk filtering.

```bash
rtk discover
rtk discover --all --since 7
```

## Workflow

1. Run `rtk discover` to identify top savings opportunities.
2. For supported commands: confirm the hook is installed (`rtk init --show`).
3. For unsupported commands: add a user-global filter in `~/Library/Application Support/rtk/filters.toml`, or a project filter in `.rtk/filters.toml`.
4. Re-run `rtk discover` after changes.
