/**
 * Rule table for the command-redirect PreToolUse(Bash) hook.
 *
 * One entry per rule: { family, id, cmds, test, reason }.
 *   cmds    argv[0] basenames the rule applies to (fast lookup)
 *   test    (args, seg, segs) => boolean; args = seg.argv.slice(1)
 *   reason  what the model should do instead (the family closer is appended
 *           by command-redirect.mjs)
 * Adding a rule is one entry. Families: secrets, gh-budget, guarded.
 * Entry order is output order. `cmds: ['*']` rules run on every segment.
 * Credential reads and the settings-deny mirrors live in
 * command-rules-mirror.mjs; shared helpers in command-rule-helpers.mjs.
 */

import { TOO_DEEP } from './command-lexer.mjs';
import {
    opts, short, long, has, joined, positional, git, REBASE_I, REBASE_X,
    descendants, ghInFanOut, INTERP_OF, interpreterRuns, scriptDeletes,
} from './command-rule-helpers.mjs';
import { SECRETS_RULES, MIRROR_RULES } from './command-rules-mirror.mjs';

const MAX_PAGE = 100;

// ---- gh-budget -------------------------------------------------------------

const LIMIT_NUMS = [
    /(?:^|\s)(?:--limit(?:=|\s+)|-L\s*)(\d+)/g,
    /\bper_page=(\d+)/g,
    /\b(?:first|last)\s*:\s*(\d+)/g,
];
const REST_SEARCH = /(?:^|\s)(?:\/?|https?:\/\/api\.github\.com\/|\S*\/api\/v3\/)search\//;
const GRAPHQL_SEARCH = /\bsearch\s*\(/;
const EXPENSIVE_ENDPOINT = /(?:^|[\s/])(?:events|stargazers|forks|contributors)(?=[/?\s]|$)|\/traffic\/|\/commits(?=[?\s]|$)/;

const ghApi = (args) => args[0] === 'api';
const ghGraphql = (args) => ghApi(args) && args.includes('graphql');
const writeMethod = (args) => {
    const s = joined(args);
    return /\s(?:-X\s*|--method[=\s]+)(?:POST|PUT|PATCH|DELETE)\b/i.test(s);
};

// ---- reasons ---------------------------------------------------------------

const R = {
    loop: "Don't loop over gh (for/while/until loops, seq/xargs/parallel fan-out). Batch into one GraphQL query using aliases (a: repository(owner:\"o\",name:\"r\"){...} b: repository(...){...}) or one gh api call with a server-side filter.",
    paginate: 'No --paginate/--slurp. Tighten the filter server-side (--state/--label/--author/--search, or query params) or ask the user before walking pages.',
    limit: 'Keep --limit/-L, per_page and first:/last: at or below 100 and filter server-side instead of pulling more rows.',
    search: 'search/* (REST search endpoints and GraphQL search()) is an expensive endpoint; use a filtered list endpoint (e.g. gh pr list/gh issue list with --state/--label/--author/--search) unless the task is specifically about search. If the task is genuinely a search, use the `gh search` subcommand with a narrow query and --limit ≤100.',
    expensive: '/events, /stargazers, /forks, /contributors, /traffic/ and commit lists are the most expensive endpoints. Use a narrower endpoint or filter instead (a single-object endpoint such as repos/o/r/commits/<sha>, or commits?since=...&until=...&path=...&per_page=50). Use them only when the task is specifically about that data, and then as one call with an explicit per_page≤100 and no pagination.',
    delete: 'Recursive or bulk deletion (`rm -r`, `rimraf`/`del`, `find -delete`/`-exec rm`, `xargs rm`, `truncate`, `mv … /dev/null`) is irreversible. Move things to the Trash instead: `trash <path>` (or `mv <path> "$TMPDIR/"`); for build output use the project\'s clean script (`make clean`, `cargo clean`, `npm run clean`).',
    scriptDelete: 'Recursive deletion from inline python/node/tsx/perl/ruby code (shutil.rmtree, fs.rm {recursive:true}, rimraf, a shelled-out `rm -r`) is irreversible, the same as `rm -r`. Use `trash <path>` (or `mv <path> "$TMPDIR/"`) or the project\'s clean script.',
    gitDiscard: 'Discarding uncommitted work (`git reset --hard/--merge`, `git checkout -- …`/`.`/`-f`, `git restore` of the working tree, `git switch -f/-C/--discard-changes`, `git clean -f/-x/-X`) is irreversible. Set the work aside recoverably with `git stash push -u -m "<why>"`, unstage with `git restore --staged <path>`, and preview cleans with `git clean -n`.',
    gitBranchForce: 'Force-deleting, force-moving or force-renaming a branch (`git branch -D/-f/-M/-C/--force`) can drop commits irreversibly. Use `git branch -d <name>` to delete and `git branch -m <old> <new>` to rename; both refuse instead of overwriting. If it refuses, leave the branch and note it.',
    gitRebaseExec: '`git rebase -x/--exec <cmd>` runs an arbitrary shell command at every rebased commit. Rebase plainly (`git rebase <base>`), then run the check once on the result (e.g. `npm test`).',
    gitHistoryRewrite: '`git filter-branch`/`git filter-repo` rewrite every commit (and filter-branch runs arbitrary shell filters). History rewrites are a user action.',
    tooDeep: 'This command nests commands inside commands (sh -c, eval, wrappers) too deeply to check. Run the inner command directly.',
    gitPushForce: 'Force pushing (`--force`, `-f`, `+refspec`, `--force-with-lease`, `--force-if-includes`, `--mirror`) rewrites shared remote history. Never force push; push the work to a new branch instead (`git push -u origin <new-branch>`).',
    gitPushDelete: 'Deleting remote refs (`git push --delete`/`-d`/`:branch`, `--prune`) is irreversible for everyone. Leave the remote branch and note it.',
    gitPushTags: '`git push --tags` publishes every local tag at once, outward-facing and hard to retract. Push only the tag you mean: `git push origin <tag>`.',
    gitStashDrop: 'Dropping or clearing stashes (`git stash drop/clear`) is irreversible. Leave the stash in place (`git stash list` shows it) and note it.',
    gitTag: 'Deleting or force-moving a tag (`git tag -d/-f`) is irreversible and the tag may already be published. Create a new tag name instead and leave existing tags alone.',
    gitWorktreeForce: '`git worktree remove --force` deletes the worktree\'s uncommitted changes irreversibly. Use `git worktree remove <path>` (refuses when dirty); if it is dirty, commit or `git stash push -u` there first, or leave it and note it.',
    gitRmForce: '`git rm -f` deletes files with uncommitted changes irreversibly. Use `git rm <path>` / `git rm -r <dir>` without -f (refuses when files have local changes), or `git rm --cached` to untrack.',
    gitSubmodule: '`git submodule deinit` removes the submodule\'s working tree. Leave the submodule in place and note it.',
    gitRemote: 'Changing remotes (`git remote remove/rename/set-url`) rewires where pushes go. Inspect with `git remote -v`; remote changes are a user action.',
    gitConfig: 'Global/system git config (`--global`, `--system`) changes every repository on this machine, and `core.hooksPath` disables hooks. Read the effective value with `git config --get <key>`, set repo-local config without --global, or use `git -c key=value <cmd>` for one command.',
    gitGc: '`git gc`/`git repack` can prune unreachable objects that recovery depends on, and the task does not need it. Skip it.',
    gitPruneTags: '`git fetch --prune-tags` deletes local tags that are missing on the remote. Use plain `git fetch` (or `git fetch --tags`).',
    gitRebaseInteractive: 'Interactive rebase (`git rebase -i`) needs an editor and hangs here. Use a non-interactive `git rebase <base>`, or `git commit --fixup` plus `GIT_SEQUENCE_EDITOR=true git rebase --autosquash <base>`.',
    publish: 'Publishing to or changing a package registry (publish, unpublish, deprecate, yank, gem push) is outward-facing and irreversible. Release is a user action: prepare it (version bump, changelog, `npm pack --dry-run`) and stop there.',
    registryAuth: 'Registry login/logout (`npm login/logout/adduser`) changes stored credentials. Check with `npm whoami`; logging in or out is a user action.',
    globalInstall: 'Global/system package changes (`npm -g`, `pnpm -g`, `yarn global`, `bun -g`, `cargo install/uninstall`, `gem uninstall`, `brew …`, `pip uninstall`, `make install/uninstall`, package cache/store cleanup) change state outside the project. Use `npx`/`pnpm dlx`/`uvx` for one-off tools, project-local installs (`npm install -D <pkg>`), or a venv for Python.',
    auditFix: '`npm audit fix` rewrites dependency versions across the whole tree. Run `npm audit` and upgrade the specific packages instead (`npm install <pkg>@<version>`).',
    kill: 'Killing processes (`kill`, `killall`, `pkill`) can take down work you did not start. Stop background work you started with the TaskStop tool or its own stop command; never kill processes you did not start.',
    sudo: 'Privilege escalation (`sudo`, `su`, `doas`) is system-level. Do the work without root, inside the project.',
    systemConfig: 'Changing services, preferences, schedules or power state (`launchctl` load/unload/bootstrap/kickstart…, `defaults write/delete`, `crontab`, `shutdown`/`reboot`/`halt`) is system-level. Inspect read-only instead (`launchctl list`, `launchctl print`, `defaults read`).',
    desktop: '`osascript` and `open` drive apps on the user\'s desktop. Check pages with `curl -sI <url>` or the browser tools, and files with `cat`/`ls`.',
    keys: 'Keychain, SSH and GPG key operations (`security`, `ssh-keygen`, `ssh-add`, `gpg --gen-key/--delete-*`) touch credentials. Check auth with `gh auth status`/`ssh -T git@github.com`; key management is a user action.',
    permsRecursive: 'Recursive ownership/permission/flag changes (`chmod -R`, `chown -R`, `chflags`) are hard to undo. Change the specific files you need (`chmod +x <file>`).',
    infra: 'This changes shared infrastructure (containers, images, volumes, clusters, cloud or deploy state) and cannot be undone from here. Inspect instead: `docker ps`/`images`/`inspect`, `kubectl get`/`describe`/`diff -f <file>`, `terraform plan`, `railway status`/`logs`, `aws … describe-*`/`list-*`. Destructive infra operations are user actions.',
    harness: 'Changing Claude Code itself (MCP servers, plugins, settings, updates) is harness configuration. Read-only: `claude mcp list`, `claude plugin list`, `claude config list`; changes are a user action.',
    ghUserAction: 'Changing repository settings, workflows, projects, auth or secrets (`gh repo archive/rename/edit/sync --force`, `gh project close/item-archive`, `gh workflow disable`, `gh auth login/logout/refresh`, `gh secret set`, `gh variable set`, gh … delete) is outward-facing. Inspect with the read-only `gh … view/list`; the change is a user action.',
};

// ---- the table -------------------------------------------------------------

const LAUNCHCTL_READ = new Set(['list', 'print', 'print-cache', 'print-disabled', 'blame', 'error', 'version',
    'hostinfo', 'dumpstate', 'plist', 'procinfo', 'examine', 'help']);
const KUBECTL_VALUED = /^(?:-n|--namespace|--context|--kubeconfig|--cluster|--user|-s|--server|-l|--selector)$/;
const KUBECTL_WRITE = new Set(['delete', 'apply', 'patch', 'edit', 'scale', 'exec', 'drain', 'cordon', 'uncordon',
    'replace', 'create', 'set', 'label', 'annotate', 'taint', 'autoscale', 'run', 'expose']);
const TF_WRITE = new Set(['apply', 'destroy', 'import', 'taint', 'untaint', 'force-unlock']);
const RAILWAY_WRITE = new Set(['up', 'redeploy', 'down', 'delete', 'unlink']);
const DOCKER_ALWAYS = new Set(['rm', 'rmi', 'kill', 'push', 'login', 'logout']);
const PKG_REMOVE = new Set(['uninstall', 'rm', 'remove', 'un', 'r']);
const PKG_ADD = new Set(['install', 'i', 'add']);
const GH_DELETE = new Set(['delete', 'delete-asset', 'item-delete', 'field-delete', 'remove']);
const isGlobal = (args) => short(args, /g/) || long(args, '--global') || has(args, '--location=global');

// gh api tokens that change or delete repository state (settings: `gh api * delete*`, `* visibility*`…).
const GH_API_WRITE = /(?:^|[\s/{(,])(?:delete|unpublish|transfer|visibility|archived|merge-upstream)|\s-[fF]\s*private=|\bprivate=false|\bforce=true|\s-[fF]\s*force=/i;

export const RULES = [
    ...SECRETS_RULES,

    // gh-budget
    { family: 'gh-budget', id: 'loop', cmds: ['gh'], test: (a, s, all) => ghInFanOut(s, all), reason: R.loop },
    { family: 'gh-budget', id: 'paginate', cmds: ['gh'], test: (a) => long(a, '--paginate', '--slurp'), reason: R.paginate },
    { family: 'gh-budget', id: 'limit', cmds: ['gh'],
        test: (a) => LIMIT_NUMS.some((re) => [...joined(a).matchAll(re)].some((m) => Number(m[1]) > MAX_PAGE)), reason: R.limit },
    { family: 'gh-budget', id: 'search', cmds: ['gh'],
        test: (a) => ghApi(a) && (REST_SEARCH.test(joined(a.slice(1))) || (ghGraphql(a) && GRAPHQL_SEARCH.test(joined(a)))), reason: R.search },
    { family: 'gh-budget', id: 'expensive', cmds: ['gh'],
        test: (a) => ghApi(a) && !ghGraphql(a) && EXPENSIVE_ENDPOINT.test(joined(a.slice(1)))
            && !writeMethod(a) && !/\bper_page=\d+/.test(joined(a)), reason: R.expensive },

    // guarded: file deletion
    { family: 'guarded', id: 'rm-recursive', cmds: ['rm', 'rimraf', 'del', 'del-cli'],
        test: (a, s) => s.argv[0] !== 'rm' || short(a, /[rR]/) || long(a, '--recursive'), reason: R.delete },
    { family: 'guarded', id: 'xargs-rm', cmds: ['rm'], test: (a, s) => s.wrappers.includes('xargs') || s.wrappers.includes('parallel'), reason: R.delete },
    // -delete, or rm/unlink anywhere under -exec/-execdir/-ok (fd: -x/-X), wrappers included.
    { family: 'guarded', id: 'find-delete', cmds: ['find', 'fd'],
        test: (a, s, all) => (s.argv[0] === 'find' && a.includes('-delete'))
            || descendants(s).some((x) => x.argv[0] === 'rm' || x.argv[0] === 'unlink'), reason: R.delete },
    { family: 'guarded', id: 'mv-devnull', cmds: ['mv'], test: (a) => a[a.length - 1] === '/dev/null', reason: R.delete },
    { family: 'guarded', id: 'truncate', cmds: ['truncate'], test: () => true, reason: R.delete },
    { family: 'guarded', id: 'script-delete', cmds: Object.keys(INTERP_OF),
        test: (a, s, all) => interpreterRuns(a, s, all, 'delete', scriptDeletes), reason: R.scriptDelete },

    // guarded: git
    { family: 'guarded', id: 'git-discard', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        switch (sub) {
            case 'reset': return long(rest, '--hard', '--merge');
            case 'checkout': return rest.includes('--') || rest.includes('.') || short(rest, /f/) || long(rest, '--force');
            case 'restore': {
                const staged = short(rest, /S/) || long(rest, '--staged');
                const worktree = short(rest, /W/) || long(rest, '--worktree');
                return worktree || !staged || long(rest, '--source') || short(rest, /s/);
            }
            case 'switch': return short(rest, /[fC]/) || long(rest, '--force', '--discard-changes', '--force-create');
            case 'clean': {
                // -x/-X only preview under -n/--dry-run; any force flag still deletes.
                const dry = short(rest, /n/) || long(rest, '--dry-run');
                return short(rest, /f/) || long(rest, '--force') || (!dry && short(rest, /[xX]/));
            }
            default: return false;
        }
    }, reason: R.gitDiscard },
    { family: 'guarded', id: 'git-branch-force', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        return sub === 'branch' && (short(rest, /[DfMC]/) || long(rest, '--force'));
    }, reason: R.gitBranchForce },
    { family: 'guarded', id: 'git-push-force', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        return sub === 'push' && (short(rest, /f/) || long(rest, '--force', '--force-with-lease', '--force-if-includes', '--mirror')
            || rest.some((t) => /^\+/.test(t)));
    }, reason: R.gitPushForce },
    { family: 'guarded', id: 'git-push-delete', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        return sub === 'push' && (short(rest, /d/) || long(rest, '--delete', '--prune') || rest.some((t) => /^:[^:]/.test(t)));
    }, reason: R.gitPushDelete },
    { family: 'guarded', id: 'git-push-tags', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        return sub === 'push' && long(rest, '--tags');
    }, reason: R.gitPushTags },
    { family: 'guarded', id: 'git-stash-drop', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        return sub === 'stash' && (rest[0] === 'drop' || rest[0] === 'clear');
    }, reason: R.gitStashDrop },
    { family: 'guarded', id: 'git-tag-rewrite', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        return sub === 'tag' && (short(rest, /[df]/) || long(rest, '--delete', '--force'));
    }, reason: R.gitTag },
    { family: 'guarded', id: 'git-worktree-force', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        return sub === 'worktree' && rest[0] === 'remove' && (short(rest.slice(1), /f/) || long(rest.slice(1), '--force'));
    }, reason: R.gitWorktreeForce },
    { family: 'guarded', id: 'git-rm-force', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        return sub === 'rm' && (short(rest, /f/) || long(rest, '--force'));
    }, reason: R.gitRmForce },
    { family: 'guarded', id: 'git-submodule-deinit', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        return sub === 'submodule' && rest.includes('deinit');
    }, reason: R.gitSubmodule },
    { family: 'guarded', id: 'git-remote-change', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        return sub === 'remote' && ['remove', 'rm', 'set-url', 'rename'].includes(rest[0]);
    }, reason: R.gitRemote },
    { family: 'guarded', id: 'git-config-global', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        return (sub === 'config' && (long(rest, '--global', '--system') || rest.some((t) => /^core\.hookspath$/i.test(t))))
            || a.some((t, k) => a[k - 1] === '-c' && /^core\.hookspath=/i.test(t));
    }, reason: R.gitConfig },
    { family: 'guarded', id: 'git-gc', cmds: ['git'], test: (a) => ['gc', 'repack'].includes(git(a).sub), reason: R.gitGc },
    { family: 'guarded', id: 'git-prune-tags', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        return sub === 'fetch' && (long(rest, '--prune-tags') || short(rest, /P/));
    }, reason: R.gitPruneTags },
    { family: 'guarded', id: 'git-rebase-interactive', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        return sub === 'rebase' && (opts(rest).some((t) => REBASE_I.test(t)) || long(rest, '--interactive'));
    }, reason: R.gitRebaseInteractive },
    { family: 'guarded', id: 'git-rebase-exec', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        return sub === 'rebase' && (long(rest, '--exec') || opts(rest).some((t) => REBASE_X.test(t)));
    }, reason: R.gitRebaseExec },
    { family: 'guarded', id: 'git-history-rewrite', cmds: ['git'],
        test: (a) => ['filter-branch', 'filter-repo'].includes(git(a).sub), reason: R.gitHistoryRewrite },
    { family: 'guarded', id: 'nesting-too-deep', cmds: [TOO_DEEP], test: () => true, reason: R.tooDeep },

    // guarded: package registries and global installs
    { family: 'guarded', id: 'publish', cmds: ['npm', 'pnpm', 'yarn', 'bun', 'poetry', 'cargo', 'gem'], test: (a, s) => {
        const tool = s.argv[0];
        const sub = positional(a).sub;
        if (tool === 'yarn' && sub === 'npm') return a.includes('publish');
        if (tool === 'cargo') return sub === 'publish' || sub === 'yank';
        if (tool === 'gem') return sub === 'push' || sub === 'yank';
        return ['publish', 'unpublish', 'deprecate'].includes(sub);
    }, reason: R.publish },
    { family: 'guarded', id: 'registry-auth', cmds: ['npm'], test: (a) => ['login', 'logout', 'adduser'].includes(positional(a).sub), reason: R.registryAuth },
    { family: 'guarded', id: 'global-install', cmds: ['npm', 'pnpm', 'yarn', 'bun', 'cargo', 'gem', 'brew', 'pip', 'pip3', 'python', 'python3', 'make'],
        test: (a, s) => {
            const tool = s.argv[0];
            const { sub, rest } = positional(a);
            switch (tool) {
                case 'npm': return ((PKG_ADD.has(sub) || PKG_REMOVE.has(sub)) && isGlobal(a))
                    || (sub === 'cache' && rest[0] === 'clean');
                case 'pnpm': return ((PKG_ADD.has(sub) || PKG_REMOVE.has(sub)) && isGlobal(a))
                    || (sub === 'store' && rest[0] === 'prune');
                case 'bun': return (PKG_ADD.has(sub) || PKG_REMOVE.has(sub)) && isGlobal(a);
                case 'yarn': return sub === 'global' || (sub === 'cache' && rest[0] === 'clean');
                case 'cargo': return sub === 'install' || sub === 'uninstall';
                case 'gem': return sub === 'uninstall';
                case 'brew': return ['install', 'reinstall', 'upgrade', 'uninstall', 'remove', 'rm', 'cleanup', 'services', 'link', 'unlink'].includes(sub);
                case 'pip': case 'pip3': return sub === 'uninstall';
                case 'python': case 'python3': return a[0] === '-m' && /^pip3?$/.test(a[1] || '') && a.includes('uninstall');
                case 'make': return a.some((t) => t === 'install' || t === 'uninstall');
                default: return false;
            }
        }, reason: R.globalInstall },
    { family: 'guarded', id: 'npm-audit-fix', cmds: ['npm'], test: (a) => positional(a).sub === 'audit' && a.includes('fix'), reason: R.auditFix },

    // guarded: processes and system
    { family: 'guarded', id: 'kill', cmds: ['kill', 'killall', 'pkill'], test: () => true, reason: R.kill },
    { family: 'guarded', id: 'sudo', cmds: ['sudo', 'su', 'doas'], test: () => true, reason: R.sudo },
    { family: 'guarded', id: 'system-config', cmds: ['launchctl', 'defaults', 'crontab', 'shutdown', 'reboot', 'halt'], test: (a, s) => {
        switch (s.argv[0]) {
            case 'launchctl': return a[0] !== undefined && !LAUNCHCTL_READ.has(a[0]);
            case 'defaults': return ['write', 'delete', 'import', 'rename'].includes(positional(a, /^-host$/).sub);
            default: return true;
        }
    }, reason: R.systemConfig },
    { family: 'guarded', id: 'desktop', cmds: ['osascript', 'open'], test: () => true, reason: R.desktop },
    { family: 'guarded', id: 'keys', cmds: ['security', 'ssh-keygen', 'ssh-add', 'gpg'], test: (a, s) => s.argv[0] !== 'gpg'
        || a.some((t) => /^--(?:delete-|gen-key|full-gen-key|generate-key|full-generate-key|quick-gen-key|quick-generate-key)/.test(t)),
    reason: R.keys },
    { family: 'guarded', id: 'perms-recursive', cmds: ['chmod', 'chown', 'chflags'],
        test: (a, s) => s.argv[0] === 'chflags' || short(a, /R/) || long(a, '--recursive'), reason: R.permsRecursive },

    // guarded: infrastructure
    { family: 'guarded', id: 'infra', cmds: ['docker', 'docker-compose'], test: (a, s) => {
        const args = s.argv[0] === 'docker-compose' ? ['compose', ...a] : a;
        const { sub, rest } = positional(args, /^(?:--context|-c|-H|--host|--config|-l|--log-level)$/);
        if (DOCKER_ALWAYS.has(sub)) return true;
        if (['image', 'container', 'volume', 'network', 'builder', 'system'].includes(sub)) {
            return ['rm', 'prune', 'remove'].includes(rest[0]);
        }
        if (sub === 'compose') {
            const verb = positional(rest, /^(?:-f|--file|-p|--project-name|--profile|--env-file)$/);
            if (verb.sub === 'down' || verb.sub === 'rm') return short(verb.rest, /v/) || long(verb.rest, '--volumes');
            return verb.sub === 'kill' || verb.sub === 'push';
        }
        return false;
    }, reason: R.infra },
    { family: 'guarded', id: 'infra', cmds: ['kubectl'], test: (a) => {
        const { sub, rest } = positional(a, KUBECTL_VALUED);
        if (sub === 'rollout') return !['status', 'history'].includes(rest[0]);
        return KUBECTL_WRITE.has(sub);
    }, reason: R.infra },
    { family: 'guarded', id: 'infra', cmds: ['terraform'], test: (a) => {
        const { sub, rest } = positional(a);
        if (TF_WRITE.has(sub)) return true;
        if (sub === 'state') return ['rm', 'mv', 'push', 'replace-provider'].includes(rest[0]);
        if (sub === 'workspace') return rest[0] === 'delete';
        return false;
    }, reason: R.infra },
    { family: 'guarded', id: 'infra', cmds: ['railway'], test: (a) => {
        const { sub, rest } = positional(a);
        if (RAILWAY_WRITE.has(sub)) return true;
        if (sub === 'variables') return ['set', 'delete'].includes(rest[0]) || long(a, '--set');
        if (sub === 'volume') return rest[0] === 'delete';
        return false;
    }, reason: R.infra },
    { family: 'guarded', id: 'infra', cmds: ['aws', 'gcloud', 'az'], test: (a, s) => {
        if (s.argv[0] !== 'aws') return a.includes('delete');
        if (a[0] === 's3') return ['rm', 'rb'].includes(a[1]) || (a[1] === 'sync' && a.includes('--delete'));
        return a.some((t) => /^(?:delete|terminate)-/.test(t));
    }, reason: R.infra },

    // guarded: harness and outward-facing gh changes
    { family: 'guarded', id: 'harness', cmds: ['claude'], test: (a) => {
        const [sub, verb] = a;
        if (sub === 'update' || sub === 'install') return true;
        if (sub === 'mcp') return ['add', 'add-json', 'add-from-claude-desktop', 'remove', 'reset-project-choices'].includes(verb);
        if (sub === 'plugin' || sub === 'plugins') return ['install', 'uninstall', 'enable', 'disable', 'marketplace'].includes(verb);
        if (sub === 'config') return ['set', 'add', 'remove'].includes(verb);
        return false;
    }, reason: R.harness },
    { family: 'guarded', id: 'gh-user-action', cmds: ['gh'], test: (a) => {
        const [sub, verb] = a;
        if (sub === 'api') return /\s(?:-X\s*|--method[=\s]+)DELETE\b/i.test(joined(a)) || GH_API_WRITE.test(joined(a.slice(1)));
        if (sub === 'repo') return ['archive', 'unarchive', 'rename', 'edit', 'delete'].includes(verb) || (verb === 'sync' && long(a, '--force'))
            || (verb === 'deploy-key' && GH_DELETE.has(a[2]));
        if (sub === 'org') return a.includes('delete');
        if (sub === 'issue' && a.some((t) => t.startsWith('--delete'))) return true;
        if (sub === 'pr' && long(a, '--delete-branch') && long(a, '--force')) return true;
        if (sub === 'project') return ['close', 'item-archive'].includes(verb) || GH_DELETE.has(verb);
        if (sub === 'workflow') return verb === 'disable' || verb === 'delete';
        if (sub === 'auth') return ['login', 'logout', 'refresh', 'setup-git'].includes(verb);
        if (sub === 'secret' || sub === 'variable') return verb === 'set' || GH_DELETE.has(verb);
        return ['release', 'issue', 'label', 'gist', 'run', 'cache', 'ruleset', 'extension', 'alias', 'ssh-key', 'gpg-key', 'codespace'].includes(sub)
            && GH_DELETE.has(verb);
    }, reason: R.ghUserAction },
    ...MIRROR_RULES,
];

/** argv[0] -> rules, for the fast first-token lookup; ANY_CMD_RULES run on every segment. */
export const RULES_BY_CMD = new Map();
export const ANY_CMD_RULES = [];
RULES.forEach((rule, order) => {
    rule.order = order;
    for (const c of rule.cmds) {
        if (c === '*') { ANY_CMD_RULES.push(rule); continue; }
        if (!RULES_BY_CMD.has(c)) RULES_BY_CMD.set(c, []);
        RULES_BY_CMD.get(c).push(rule);
    }
});
