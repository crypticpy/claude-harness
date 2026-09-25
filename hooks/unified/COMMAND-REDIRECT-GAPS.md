# command-redirect: known gaps

The `pre-bash` hook (`modules/command-redirect.mjs` and friends) denies dangerous
or budget-violating Bash commands with a reason, and `permissions.ask` is empty,
so nothing here reaches a human prompt. It matches command text, so it can't
catch every path. These are the gaps known when it shipped (2026-09-25), accepted
rather than fixed.

## Secrets can still reach the transcript

- Token-printing commands that are allowlisted: `gh auth status -t` /
  `--show-token`, `kubectl config view --raw`, `printenv GITHUB_TOKEN`,
  `echo $GITHUB_TOKEN`, `env | grep TOKEN`.
- Credential files the path matchers miss:
  - relative reads after `cd` (`cd ~/.aws && cat credentials`); only bare
    `id_<type>` SSH keys are caught this way
  - globs, which aren't expanded (`cat ~/.aws/*`, `head ~/.ssh/*`)
  - recursive search of a credential directory (`grep -r token ~/.config/gh`)
  - stores not on the list: gcloud application default credentials,
    `~/.config/railway/config.json`, `~/.terraform.d/credentials.tfrc.json`,
    `~/.cargo/credentials.toml`, `~/.azure/accessTokens.json`, `~/.pgpass`,
    `~/.config/git/credentials`
- Copying a credential file elsewhere and reading the copy; `find -exec cat {}`
  on a credential path.

The durable fix is keeping secrets out of plain-text files and environment
variables (keychain-backed credential helpers), not more patterns.

## Commands the hook can't see into

- Script bodies: `bash script.sh`, `python file.py`, `npm run` scripts,
  `yarn <bin>` / `pnpm <bin>` shorthand.
- `$'…'` ANSI-C quoting, commands built at runtime (`'r'+'m -rf'`),
  `rg --pre`, ssh remote commands, `tmux send-keys`.

## Protected-file writes

Only redirects and `tee` are checked. `sed -i`, `ln -sf`, `cp` and `mv` onto
`~/.zshrc` and similar are not.

## False positives

- `rm -f .git/index.lock` is denied (also by the settings rule `rm * .git/*`),
  which stalls git after a crash; `rm -f ./.git/index.lock` is allowed.
- `jq '.mcpServers | keys' ~/.claude.json` is denied; only a bare
  `keys`/`length`/`type` filter is exempt.
- `eval "$(pyenv init -)" && curl -s localhost` is denied as pipe-to-shell.
- `--global*` deny backstops also match npm's `--global-style`;
  `kubectl apply --dry-run` is blocked by the `kubectl apply *` backstop.

## Settings rules the hook disagrees with

A settings deny that the hook would allow blocks the command with no reason:
`cat ~/.ssh/id_*.pub` (glob can't exclude `.pub`) and `ssh host ls -R /tmp`
(`ssh * -R *`). Keep hook rules and settings deny rules in step when editing
either.
