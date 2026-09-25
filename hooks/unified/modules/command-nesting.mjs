/**
 * Which commands run other commands — for the command-redirect lexer.
 *
 * stripWrappers() peels prefixes that run the rest of the argv as the real
 * command (env, nohup, timeout, xargs, npx, uv run, pnpm dlx, …).
 * nestedCommands() finds commands hidden in a parent's flags or arguments
 * (sh -c, eval, git rebase --exec, git -c core.editor=…, find -exec, …).
 * Both push what they find onto `nested`: a string is shell source to lex,
 * an array is an argv to classify directly. The lexer turns each one into
 * segments whose `parent` is the command that runs them, so every rule
 * applies to the inner command too.
 */

export const basename = (w) => w.replace(/^.*\//, '');

/**
 * Command name as rules see it: the basename, keeping an npm scope
 * (`@scope/pkg`), with a trailing @version dropped (`rimraf@5` -> `rimraf`,
 * `@scope/pkg@1` -> `@scope/pkg`).
 */
export function commandName(w) {
    return (w.startsWith('@') ? w : basename(w)).replace(/^(@?[^@]+)@[^@/]*$/, '$1');
}

/** argv[0] of the placeholder segment for nesting too deep to check. */
export const TOO_DEEP = '(nested-too-deep)';
// More wrappers than any real command stacks (timeout nice env nohup npx …).
const MAX_WRAPPERS = 12;

const ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;
// Environment variables whose value is a command git/ssh/pagers will run.
const CMD_ENV = new Set(['GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'EDITOR', 'VISUAL', 'GIT_SSH_COMMAND', 'GIT_SSH',
    'GIT_PAGER', 'PAGER', 'GIT_EXTERNAL_DIFF', 'GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_PROXY_COMMAND']);
// git config keys whose value is a command (alias.* is handled separately).
const GIT_CMD_KEY = /^(?:core\.(?:editor|pager|sshcommand|fsmonitor|askpass|gitproxy)|sequence\.editor|diff\.external|diff\..+\.(?:textconv|command)|(?:diff|merge)tool\..+\.cmd|merge\..+\.driver|filter\..+\.(?:clean|smudge|process)|credential(?:\..+)?\.helper|gpg(?:\..+)?\.program|pager\..+|interactive\.difffilter|sendemail\.sendmailcmd|uploadpack\.packobjectshook)$/;
const GIT_GLOBAL_VALUED = /^(?:-C|--git-dir|--work-tree|--namespace|--config-env)$/;
const FILTER_BRANCH_CMD = /^--(?:tree|index|msg|commit|env|parent|tag-name)-filter$/;
const RUNNER_VALUED = /^(?:-p|--package|--with|--with-requirements|--with-editable|--python|--directory|--project|--from|--spec|--index|--index-url|--extra|--group|--env-file|-w|--workspace|-C|--dir|-F|--filter|--prefix)$/;
const SUB_RUNNERS = {
    npm: ['exec', 'x'], pnpm: ['exec', 'dlx'], yarn: ['dlx', 'exec'], bun: ['x'],
    uv: ['run', 'tool'], poetry: ['run'], pipx: ['run'],
};
const SUDO_VALUED = /^(?:-[ugpChDRTUr]|--(?:user|group|prompt|close-from|host|chdir|chroot|command-timeout|other-user|role|type))$/;
const FIND_EXEC = /^-(?:exec|execdir|ok|okdir)$/;
const FD_EXEC = /^(?:-x|--exec|-X|--exec-batch)$/;

/** Tokens after leading flags (skipping values of `valued` flags and a `--`). */
function afterFlags(rest, valued) {
    let j = 0;
    while (j < rest.length && rest[j].startsWith('-') && rest[j] !== '-') {
        if (rest[j] === '--') return rest.slice(j + 1);
        j += valued.test(rest[j]) ? 2 : 1;
    }
    return rest.slice(j);
}

/** Value of `--flag=value` or of the token after `--flag`/`-f`; undefined if absent. */
function flagValue(args, i, names) {
    const t = args[i];
    for (const n of names) {
        if (t === n) return args[i + 1];
        if (n.startsWith('--') && t.startsWith(n + '=')) return t.slice(n.length + 1);
    }
    return undefined;
}

function stripAssignments(w, nested) {
    let k = 0;
    for (let m; k < w.length && (m = ASSIGN.exec(w[k])); k++) {
        if (CMD_ENV.has(m[1]) && m[2]) nested.push(m[2]);
    }
    return k ? w.slice(k) : w;
}

// npm exec / pnpm dlx / uv run / poetry run …: the argv after the subcommand.
function subRunner(head, rest, nested) {
    const subs = SUB_RUNNERS[head];
    let i = 0;
    while (i < rest.length && rest[i].startsWith('-')) i += RUNNER_VALUED.test(rest[i]) ? 2 : 1;
    if (!subs.includes(rest[i])) return undefined;
    if (rest[i] === 'tool') {
        if (rest[i + 1] !== 'run') return undefined;
        i++;
    }
    const tail = rest.slice(i + 1);
    for (let j = 0; j < tail.length && tail[j].startsWith('-') && tail[j] !== '--'; j++) {
        if ((head === 'npm') && (tail[j] === '-c' || tail[j] === '--call' || tail[j].startsWith('--call='))) {
            nested.push(flagValue(tail, j, ['-c', '--call']) ?? '');
            return [];
        }
        if (head === 'pnpm' && (tail[j] === '-c' || tail[j] === '--shell-mode')) {
            nested.push(afterFlags(tail, RUNNER_VALUED).join(' '));
            return [];
        }
    }
    return afterFlags(tail, RUNNER_VALUED);
}

// Each returns the effective words after the wrapper, or undefined when the
// head is not a wrapper in this form.
const WRAPPERS = {
    env(rest, wrappers, nested) {
        wrappers.push('env');
        // env -S 'cmd args' / --split-string=… splits one string into the command.
        for (let j = 0; j < rest.length && rest[j].startsWith('-') && rest[j] !== '--'; j++) {
            const t = rest[j];
            const sep = t === '-S' || t === '--split-string';
            const glued = /^-S./.test(t) ? t.slice(2) : t.startsWith('--split-string=') ? t.slice(15) : undefined;
            if (sep || glued !== undefined) {
                nested.push([sep ? rest[j + 1] ?? '' : glued, ...rest.slice(j + (sep ? 2 : 1))].join(' '));
                return [];
            }
            if (/^-[uCP]$|^--(?:unset|chdir)$/.test(t)) j++;
        }
        return afterFlags(rest, /^-[uCP]$|^--(?:unset|chdir)$/);
    },
    command: (rest) => (rest.some((a) => /^-[a-zA-Z]*[vV]/.test(a)) ? [] : afterFlags(rest, /^$/)),
    builtin: (rest) => afterFlags(rest, /^$/),
    exec: (rest) => afterFlags(rest, /^-a$/),
    nohup: (rest) => afterFlags(rest, /^$/),
    time: (rest) => afterFlags(rest, /^-o$/),
    nice: (rest) => afterFlags(rest, /^-n$/),
    caffeinate: (rest) => afterFlags(rest, /^-[tw]$/),
    busybox: (rest) => rest,
    shx: (rest) => afterFlags(rest, /^$/), // shx rm -rf x: shelljs shim for the real command
    timeout: (rest) => afterFlags(rest, /^(?:-[sk]|--signal|--kill-after)$/).slice(1), // drop the duration
    xargs(rest, wrappers) {
        wrappers.push('xargs');
        return afterFlags(rest, /^-[IdEsnPLa]$/);
    },
    parallel(rest, wrappers, nested) {
        wrappers.push('parallel');
        const r = afterFlags(rest, /^(?:-[jSn]|--jobs|--sshlogin)$/);
        const k = r.findIndex((t) => /^::::?\+?$/.test(t));
        const cmd = k < 0 ? r : r.slice(0, k);
        // parallel runs its command through a shell; with no command, each
        // argument after ::: is itself a command.
        if (cmd.length) nested.push(cmd.join(' '));
        else for (const t of r.slice(k + 1)) if (!/^::::?\+?$/.test(t)) nested.push(t);
        return [];
    },
    watch(rest, wrappers, nested) {
        wrappers.push('watch');
        const r = afterFlags(rest, /^(?:-n|--interval)$/);
        if (r.length) nested.push(r.join(' '));
        return [];
    },
    entr(rest, wrappers, nested) {
        wrappers.push('entr');
        const shell = rest.some((t) => /^-[a-z]*s/.test(t));
        const r = afterFlags(rest, /^$/);
        if (!shell) return r;
        if (r.length) nested.push(r.join(' '));
        return [];
    },
    npx(rest, wrappers, nested) {
        for (let j = 0; j < rest.length && rest[j].startsWith('-') && rest[j] !== '--'; j++) {
            const c = flagValue(rest, j, ['-c', '--call']);
            if (c !== undefined) {
                nested.push(c);
                return [];
            }
            if (RUNNER_VALUED.test(rest[j])) j++;
        }
        return afterFlags(rest, RUNNER_VALUED);
    },
    bunx: (rest) => afterFlags(rest, RUNNER_VALUED),
    uvx: (rest) => afterFlags(rest, RUNNER_VALUED),
    npm: (rest, wrappers, nested) => subRunner('npm', rest, nested),
    pnpm: (rest, wrappers, nested) => subRunner('pnpm', rest, nested),
    yarn: (rest, wrappers, nested) => subRunner('yarn', rest, nested),
    bun: (rest, wrappers, nested) => subRunner('bun', rest, nested),
    uv: (rest, wrappers, nested) => subRunner('uv', rest, nested),
    poetry: (rest, wrappers, nested) => subRunner('poetry', rest, nested),
    pipx: (rest, wrappers, nested) => subRunner('pipx', rest, nested),
};

/**
 * Strip wrapper commands (recording fan-out ones); returns the effective argv,
 * or [TOO_DEEP] when wrappers are stacked past MAX_WRAPPERS.
 */
export function stripWrappers(words, wrappers, nested) {
    let w = words;
    for (let n = 0; w.length; n++) {
        w = stripAssignments(w, nested);
        if (!w.length) break;
        const head = commandName(w[0]);
        if (!Object.hasOwn(WRAPPERS, head)) break;
        if (n === MAX_WRAPPERS) return [TOO_DEEP];
        const next = WRAPPERS[head](w.slice(1), wrappers, nested);
        if (next === undefined) break;
        w = next;
    }
    return w;
}

function gitConfigValue(key, value, nested) {
    if (value == null) return;
    const k = key.toLowerCase();
    if (k.startsWith('alias.')) nested.push(value.startsWith('!') ? value.slice(1) : `git ${value}`);
    else if (GIT_CMD_KEY.test(k)) nested.push(value);
}

function gitNested(argv, nested) {
    let i = 1;
    for (; i < argv.length && argv[i].startsWith('-'); i++) {
        if (argv[i] === '-c') {
            const kv = argv[++i] || '';
            const eq = kv.indexOf('=');
            if (eq > 0) gitConfigValue(kv.slice(0, eq), kv.slice(eq + 1), nested);
        } else if (GIT_GLOBAL_VALUED.test(argv[i])) {
            i++;
        }
    }
    const sub = argv[i];
    const rest = argv.slice(i + 1);
    switch (sub) {
        case 'rebase':
        case 'difftool': {
            // --exec cmd / --exec=cmd, and -x in a short cluster: `-x cmd`,
            // `-xcmd`, `-kx cmd` (git takes the rest of the cluster, else the next arg).
            const longName = sub === 'rebase' ? '--exec' : '--extcmd';
            for (let j = 0; j < rest.length && rest[j] !== '--'; j++) {
                const t = rest[j];
                const m = /^-([a-rt-wyzA-BD-RT-WYZ]*)x([\s\S]*)$/.exec(t); // not -Xfoo/-sfoo values
                const v = flagValue(rest, j, [longName]) ?? (m ? m[2] || rest[j + 1] : undefined);
                if (v !== undefined) nested.push(v);
            }
            return sub === 'rebase';
        }
        case 'filter-branch':
            rest.forEach((t, j) => {
                const m = /^(--[a-z-]+-filter)(?:=|$)/.exec(t);
                if (m && FILTER_BRANCH_CMD.test(m[1])) nested.push(flagValue(rest, j, [m[1]]) ?? '');
            });
            break;
        case 'bisect':
            if (rest[0] !== 'run') return false;
            nested.push(rest.slice(1));
            return true;
        case 'submodule': {
            const k = rest.indexOf('foreach');
            if (k < 0) return false;
            nested.push(afterFlags(rest.slice(k + 1), /^$/).join(' '));
            return true;
        }
        case 'config': {
            const pos = [];
            for (let j = 0; j < rest.length; j++) {
                if (/^(?:-f|--file|--blob|--type|--default|--comment|--value)$/.test(rest[j])) j++;
                else if (!rest[j].startsWith('-')) pos.push(rest[j]);
            }
            if (pos[0] === 'set') pos.shift();
            if (pos.length >= 2) gitConfigValue(pos[0], pos[1], nested);
            break;
        }
        case 'grep':
            rest.forEach((t) => {
                const m = /^(?:-O|--open-files-in-pager=)(.+)$/.exec(t);
                if (m) nested.push(m[1]);
            });
            break;
        default:
            break;
    }
}

/**
 * Commands a (post-wrapper) argv runs through its own flags or arguments.
 * Returns true when they run once per item (find -exec, git rebase --exec,
 * git submodule foreach, git bisect run): a fan-out, like a loop.
 */
export function nestedCommands(argv, nested) {
    const head = argv[0];
    switch (head) {
        case 'sh': case 'bash': case 'zsh': case 'dash': case 'ksh': {
            const k = argv.findIndex((a, idx) => idx > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
            if (k > 0 && argv[k + 1] != null) nested.push(argv[k + 1]);
            break;
        }
        case 'eval':
            if (argv.length > 1) nested.push(argv.slice(1).join(' '));
            break;
        case 'sudo': case 'doas': { // the sudo rule denies these too; the target still gets its own rules
            const target = afterFlags(argv.slice(1), SUDO_VALUED);
            if (target.length) nested.push(target);
            break;
        }
        case 'su': {
            const k = argv.findIndex((a, idx) => idx > 0 && (a === '-c' || a === '--command'));
            if (k > 0 && argv[k + 1] != null) nested.push(argv[k + 1]);
            break;
        }
        case 'export': case 'declare': case 'typeset': case 'local': case 'readonly':
            stripAssignments(argv.slice(1).filter((a) => !a.startsWith('-')), nested);
            break;
        case 'git':
            return gitNested(argv, nested);
        case 'find':
        case 'fd': {
            const isExec = head === 'find' ? FIND_EXEC : FD_EXEC;
            for (let j = 1; j < argv.length; j++) {
                if (!isExec.test(argv[j])) continue;
                let e = j + 1;
                while (e < argv.length && argv[e] !== ';' && argv[e] !== '+') e++;
                nested.push(argv.slice(j + 1, e));
                j = e;
            }
            return true;
        }
        case 'nodemon':
            argv.forEach((t, j) => {
                const v = flagValue(argv, j, ['-x', '--exec']);
                if (v !== undefined) nested.push(v);
            });
            break;
        default:
            break;
    }
}
