/**
 * Credential-read rules, and hook mirrors of the deny-only destructive
 * commands in settings `permissions.deny` (disk erase, git ref destruction,
 * boot/security settings, network exposure, curl | sh, writes to protected
 * files, deletes of protected locations). Same entry shape as
 * command-rules.mjs; `cmds: ['*']` rules run on every segment and must stay
 * cheap. Without a mirror, settings deny these with no reason, so the model
 * cannot rewrite the command by itself.
 */

import {
    short, long, positional, scanFlags, git, pipeStage, firstStage, anySeg,
    INTERP_OF, interpreterProgram, interpreterRuns, HOME, credArg, credText,
} from './command-rule-helpers.mjs';

const R = {
    secrets: "Don't print credential files or tokens into the transcript. Check auth with `gh auth status`/`npm whoami`/`kubectl config current-context`, or list structure without values (e.g. `jq 'keys' ~/.claude.json`, `grep -c` for a key). gh and other CLIs authenticate on their own; you never need the raw token.",
    diskErase: 'Erasing, overwriting or reformatting (`shred`, `srm`, `wipe`, `dd`, `mkfs`/`newfs`, `fdisk`/`gpt`, `diskutil erase*/partitionDisk/apfs delete*`, `asr`, `tmutil delete/disable`) is irreversible. Move files to the Trash with `trash <path>`; disk and backup changes are a user action.',
    gitRefDestroy: '`git reflog expire/delete`, `git update-ref -d`, `git replace` and `git prune` destroy or rewrite the refs and objects that recovery depends on. Leave refs in place; inspect with `git reflog` or `git show-ref`.',
    systemSecurity: 'Boot, security and account settings (`csrutil`, `nvram`, `bless`, `systemsetup`, `spctl --master-disable`, `sysadminctl`, `passwd`, `dscl` writes) are system-level. Do the work without them; changing them is a user action.',
    networkExpose: 'This exposes a local port to the network or the internet (`ngrok`, `cloudflared tunnel`, `ssh -R`, `socat`, `nc -l`, `http.server --bind 0.0.0.0`). Bind dev servers to 127.0.0.1 (e.g. `python3 -m http.server 8000 --bind 127.0.0.1`); tunnels and listeners are a user action.',
    pipeToShell: 'Piping a downloaded script into a shell or interpreter (`curl … | sh`, `bash <(curl …)`, `sh -c "$(curl …)"`) runs unreviewed remote code. Download it to a file (`curl -fsSLo "$TMPDIR/install.sh" <url>`), read it, and run only the steps you need; installing tools is usually a user action.',
    protectedWrite: 'Writing to shell startup files, ~/.gitconfig, ~/.ssh, Claude Code settings (~/.claude/settings*.json, ~/.claude.json) or system paths (/etc, /usr, /System, /Library, /bin, /sbin, raw disks) changes this machine outside the project. Write inside the project or $TMPDIR; edits to these files are a user action.',
    rmProtected: 'This deletes a protected location (home, `.`/`..`, .git, system paths, ~/.ssh, ~/.gnupg, ~/.claude settings or hooks, top-level user folders) or passes --no-preserve-root. Leave it in place; if it truly must go, that is a user action.',
};

// ---- secrets ---------------------------------------------------------------

// Commands that print (or transform and print) the files they are given.
const READERS = ['cat', 'tac', 'nl', 'less', 'more', 'head', 'tail', 'bat', 'batcat', 'grep', 'egrep', 'fgrep', 'rg', 'ag',
    'ack', 'jq', 'yq', 'awk', 'gawk', 'sed', 'strings', 'xxd', 'hexdump', 'od', 'base64', 'cut', 'sort', 'uniq', 'diff',
    'comm', 'paste', 'rev', 'fold', 'column'];

// Tools whose first operand is a pattern/program, not a file, unless a
// program flag (-e/-f…) supplies it. `count` flags make grep-likes print
// counts or file names only.
const GREP_LONG = new Set(['--regexp', '--file', '--max-count', '--after-context', '--before-context', '--context',
    '--devices', '--directories', '--label', '--include', '--exclude', '--exclude-dir', '--binary-files', '--glob', '--iglob',
    '--replace', '--type', '--type-not', '--max-depth', '--threads', '--encoding', '--max-columns', '--pre', '--pre-glob']);
const GREP_COUNT = ['--count', '--count-matches', '--files-with-matches', '--files-without-match', '--files-without-matches', '--quiet', '--silent'];
const grep = { valued: 'efmABCdD', prog: 'ef', long: GREP_LONG, count: 'clLq' };
const PATTERN_FIRST = {
    grep, egrep: grep, fgrep: grep,
    rg: { valued: 'efmABCgrtTEMjd', prog: 'ef', long: GREP_LONG, count: 'clq' }, // rg -L is --follow
    ag: { valued: 'ABCGgm', prog: '', long: GREP_LONG, count: 'clL' },
    ack: { valued: 'ABCm', prog: '', long: GREP_LONG, count: 'clL' },
    awk: { valued: 'fvFe', prog: 'fe' }, gawk: { valued: 'fvFe', prog: 'fe' },
    sed: { valued: 'efl', prog: 'ef', long: new Set(['--expression', '--file']) },
    jq: { valued: 'Lf', prog: 'f', long: new Set(['--from-file', '--indent']) },
    yq: { valued: '', prog: '' },
};
const PROG_LONG = new Set(['--regexp', '--file', '--expression', '--from-file']);
// jq may print a file's structure (never values): only these filters, only boolean output flags.
const JQ_STRUCTURE = new Set(['keys', 'keys_unsorted', 'length', 'type']);
const JQ_BOOL_SHORT = /^-[rjcMCSea]+$/;
const JQ_BOOL_LONG = new Set(['--raw-output', '--join-output', '--compact-output', '--monochrome-output', '--color-output',
    '--sort-keys', '--exit-status', '--ascii-output', '--tab']);

/** A reader given a credential file, other than count-only grep and structure-only jq. */
function readsCredential(a, s) {
    const spec = PATTERN_FIRST[s.argv[0]];
    let skip = -1;
    if (spec) {
        const f = scanFlags(a, spec.valued, spec.long);
        if (spec.count && ([...spec.count].some((c) => f.chars.has(c)) || GREP_COUNT.some((n) => f.longs.has(n)))) return false;
        if (s.argv[0] === 'jq' && f.operand >= 0 && JQ_STRUCTURE.has(a[f.operand])
            && a.every((t) => !t.startsWith('-') || JQ_BOOL_SHORT.test(t) || JQ_BOOL_LONG.has(t))) return false;
        const progFlag = [...spec.prog].some((c) => f.chars.has(c)) || [...f.longs].some((n) => PROG_LONG.has(n));
        if (!progFlag) skip = f.operand;
    }
    return a.some((t, k) => k !== skip && credArg(t));
}

const DEV_STDIO = /^\/dev\/(?:stdout|stderr|tty|fd\/\d+)$/;

// ---- redirects -------------------------------------------------------------

// A redirect word: [n|&]>, >>, >|, <>, < with its target glued on or in the next word.
// `<<<` here-strings, `<<` heredocs and `>&n` fd duplication are not file targets.
const REDIRECT = /^(?:\d+|&)?(>>?\|?|<>?)(?!<)(.*)$/s;

/** [op, target] for each file redirect in argv. */
function redirects(argv) {
    const out = [];
    for (let k = 0; k < argv.length; k++) {
        const t = argv[k];
        if (!t.includes('>') && !t.includes('<')) continue;
        const m = REDIRECT.exec(t);
        if (!m) continue;
        const target = m[2] || argv[k + 1];
        if (target != null && !target.startsWith('&')) out.push([m[1], target]);
        if (!m[2]) k++;
    }
    return out;
}

// Mirrors settings `* > ~/.zshrc*`, `* > /etc/*`, `tee ~/.ssh/*`, `* > ~/.claude/settings.json`…
const PROTECTED_WRITE = new RegExp(String.raw`^(?:${HOME}/(?:\.(?:zshrc|bashrc|bash_profile|zprofile|profile|gitconfig)|\.ssh/`
    + String.raw`|\.claude/settings(?:\.template)?\.json$|\.claude\.json$)|/(?:private/)?etc/|/(?:usr|System|Library|bin|sbin)/|/dev/(?:r?disk|sd))`);

// Mirrors settings `rm * ~`, `rm * .git/*`, `rm * /System*`, `rm * ~/.claude/hooks*`…
const RM_PROTECTED = new RegExp('^(?:' + [
    `${HOME}/?`, '/Users/?', String.raw`/\*?`, String.raw`\.\.?/?`,
    String.raw`(?:.*/)?\.git/?`, String.raw`\.git/.*`, String.raw`.*/\.git/(?:objects|refs)(?:/.*)?`,
    String.raw`/(?:System|Library|usr|etc|bin|sbin|private/etc|private/var/db|Applications|Volumes)(?:/.*)?`,
    '/opt/homebrew/?', '/dev/.*',
    String.raw`${HOME}/\.ssh(?:/.*)?`, String.raw`${HOME}/\.gnupg.*`,
    String.raw`${HOME}/\.claude/?`, String.raw`${HOME}/\.claude/settings(?:\.template)?\.json`, String.raw`${HOME}/\.claude/hooks.*`,
    `${HOME}/(?:Projects|Documents|Desktop|Library)/?`, `${HOME}/Library/(?:Keychains|Mobile Documents).*`,
].join('|') + ')$');

/** rm operands (everything after `--`, otherwise the non-flag words). */
function rmOperands(a) {
    const k = a.indexOf('--');
    const before = (k < 0 ? a : a.slice(0, k)).filter((t) => !t.startsWith('-'));
    return k < 0 ? before : [...before, ...a.slice(k + 1)];
}

// ---- pipe-to-shell ---------------------------------------------------------

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const FETCH = new Set(['curl', 'wget']);
const SUBST = new Set(['$(...)', '`...`']);

/** A shell reading its script from stdin: no -c and no script operand (or -s / `-`). */
function shellReadsStdin(a) {
    const f = scanFlags(a, 'oO');
    if (f.chars.has('c')) return false;
    return f.operand < 0 || f.chars.has('s') || a[f.operand] === '-';
}

// ---- the table -------------------------------------------------------------

const LISTEN_ALL = /^(?:0\.0\.0\.0|::|\[::\]|\*)$/;
const DISKUTIL_ERASE = /^(?:erase|partitionDisk$|reformat$|zeroDisk$|randomDisk$|secureErase$)/i;

export const SECRETS_RULES = [
    { family: 'secrets', id: 'secrets', cmds: READERS, test: readsCredential, reason: R.secrets },
    { family: 'secrets', id: 'secrets', cmds: ['cp'],
        test: (a) => a.length > 1 && DEV_STDIO.test(a[a.length - 1]) && a.slice(0, -1).some(credArg), reason: R.secrets },
    { family: 'secrets', id: 'secrets', cmds: Object.keys(INTERP_OF),
        test: (a, s, all) => interpreterRuns(a, s, all, 'cred', credText), reason: R.secrets },
    { family: 'secrets', id: 'secrets', cmds: ['defaults'],
        test: (a) => positional(a, /^-host$/).sub === 'read' && a.some((t) => t.startsWith('com.apple.security')), reason: R.secrets },
    // Input redirect from a credential file into any other command: `read x < ~/.npmrc`, `$(< ~/.npmrc)`.
    { family: 'secrets', id: 'secrets', cmds: ['*'], test: (a, s) => !READERS.includes(s.argv[0]) && s.argv[0] !== 'wc'
        && redirects(s.argv).some(([op, t]) => op[0] === '<' && credArg(t)), reason: R.secrets },
    { family: 'secrets', id: 'secrets', cmds: ['gh'], test: (a) => a[0] === 'auth' && a[1] === 'token', reason: R.secrets },
];

export const MIRROR_RULES = [
    { family: 'guarded', id: 'disk-erase', cmds: ['shred', 'srm', 'wipe', 'dd', 'fdisk', 'gpt', 'asr'], test: () => true, reason: R.diskErase },
    { family: 'guarded', id: 'disk-erase', cmds: ['*'], test: (a, s) => /^(?:mkfs|newfs)/.test(s.argv[0] ?? ''), reason: R.diskErase },
    { family: 'guarded', id: 'disk-erase', cmds: ['diskutil'], test: (a) => {
        const [sub, verb] = a;
        if (/^apfs$/i.test(sub ?? '')) return /^(?:delete|erase)/i.test(verb ?? '');
        if (/^unmountDisk$/i.test(sub ?? '')) return a.includes('force');
        return DISKUTIL_ERASE.test(sub ?? '');
    }, reason: R.diskErase },
    { family: 'guarded', id: 'disk-erase', cmds: ['tmutil'], test: (a) => /^(?:delete|disable)/.test(a[0] ?? ''), reason: R.diskErase },

    { family: 'guarded', id: 'git-ref-destroy', cmds: ['git'], test: (a) => {
        const { sub, rest } = git(a);
        if (sub === 'replace' || sub === 'prune') return true;
        if (sub === 'update-ref') return short(rest, /d/) || long(rest, '--delete');
        return sub === 'reflog' && (rest[0] === 'expire' || rest[0] === 'delete');
    }, reason: R.gitRefDestroy },

    { family: 'guarded', id: 'system-security', cmds: ['csrutil', 'nvram', 'bless', 'systemsetup', 'sysadminctl', 'passwd'],
        test: () => true, reason: R.systemSecurity },
    { family: 'guarded', id: 'system-security', cmds: ['spctl'], test: (a) => long(a, '--master-disable', '--global-disable'), reason: R.systemSecurity },
    { family: 'guarded', id: 'system-security', cmds: ['dscl'],
        test: (a) => a.some((t) => /^-(?:passwd|delete|create|append|merge|change)$/.test(t)), reason: R.systemSecurity },

    { family: 'guarded', id: 'network-expose', cmds: ['ngrok', 'socat'], test: () => true, reason: R.networkExpose },
    { family: 'guarded', id: 'network-expose', cmds: ['cloudflared'], test: (a) => a.includes('tunnel'), reason: R.networkExpose },
    // ssh options may follow the host; the remote command starts at the next operand.
    { family: 'guarded', id: 'network-expose', cmds: ['ssh'], test: (a) => {
        let operands = 0;
        for (let i = 0; i < a.length && operands < 2; i++) {
            const t = a[i];
            if (!t.startsWith('-') || t === '-') { operands++; continue; }
            for (let k = 1; k < t.length; k++) {
                if (t[k] === 'R') return true;
                if ('BbcDEeFIiJLlmOoPpQSWw'.includes(t[k])) {
                    const v = k === t.length - 1 ? a[++i] : t.slice(k + 1);
                    if (t[k] === 'o' && /^RemoteForward\b/i.test(v ?? '')) return true;
                    break;
                }
            }
        }
        return false;
    }, reason: R.networkExpose },
    { family: 'guarded', id: 'network-expose', cmds: ['nc', 'ncat', 'netcat'],
        test: (a) => scanFlags(a, 'eipsTwxXIOPV').chars.has('l') || long(a, '--listen'), reason: R.networkExpose },
    { family: 'guarded', id: 'network-expose', cmds: ['python', 'python3'], test: (a) => {
        const m = a.indexOf('-m');
        if (m < 0 || a[m + 1] !== 'http.server') return false;
        return a.some((t, k) => ((t === '--bind' || t === '-b') && LISTEN_ALL.test(a[k + 1] ?? ''))
            || (t.startsWith('--bind=') && LISTEN_ALL.test(t.slice(7))));
    }, reason: R.networkExpose },

    { family: 'guarded', id: 'pipe-to-shell', cmds: [...SHELLS, 'source', '.', 'eval', ...Object.keys(INTERP_OF)], test: (a, s, all) => {
        const first = a.find((t) => !t.startsWith('-'));
        if (SUBST.has(first) && anySeg(all, 'fetch', (x) => FETCH.has(x.argv[0]))) return true;
        if (!['source', '.', 'eval'].includes(s.argv[0]) && s.heredoc == null
            && (SHELLS.has(s.argv[0]) ? shellReadsStdin(a) : interpreterProgram(a, s).stdin)) {
            const st = pipeStage(s, all);
            const k = firstStage(st, 'fetch', (x) => FETCH.has(x.argv[0]));
            return k >= 0 && k < st.at;
        }
        return false;
    }, reason: R.pipeToShell },

    { family: 'guarded', id: 'protected-write', cmds: ['*'],
        test: (a, s) => redirects(s.argv).some(([op, t]) => op[0] !== '<' && PROTECTED_WRITE.test(t)), reason: R.protectedWrite },
    { family: 'guarded', id: 'protected-write', cmds: ['tee'],
        test: (a) => a.some((t) => !t.startsWith('-') && PROTECTED_WRITE.test(t)), reason: R.protectedWrite },

    { family: 'guarded', id: 'rm-protected', cmds: ['rm'],
        test: (a) => long(a, '--no-preserve-root') || rmOperands(a).some((t) => RM_PROTECTED.test(t)), reason: R.rmProtected },
];
