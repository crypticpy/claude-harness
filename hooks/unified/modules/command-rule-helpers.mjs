/**
 * Shared helpers for the command-redirect rule tables (command-rules.mjs,
 * command-rules-mirror.mjs): argv flag parsing, pipeline lookups, inline
 * interpreter code, and credential-path matching.
 *
 * Everything here is linear in the command size: rules run on every Bash
 * call, and a command can be hundreds of KB.
 */

import { homedir } from 'os';

// ---- argv helpers ----------------------------------------------------------

/** Tokens before a `--` end-of-options marker. */
export const opts = (args) => {
    const k = args.indexOf('--');
    return k < 0 ? args : args.slice(0, k);
};
/** Any short-flag cluster (e.g. -rf) containing a char matching re. */
export const short = (args, re) => opts(args).some((a) => /^-[A-Za-z]/.test(a) && re.test(a.slice(1)));
/** --name or --name=value present. */
export const long = (args, ...names) => opts(args).some((a) => names.some((n) => a === n || a.startsWith(n + '=')));
export const has = (args, ...words) => args.some((a) => words.includes(a));
export const joined = (args) => ' ' + args.join(' ');

/** First positional token, skipping flags (and the values of valued flags). */
export function positional(args, valued = /^$/) {
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--') return { sub: args[i + 1], rest: args.slice(i + 2) };
        if (a.startsWith('-')) { if (valued.test(a)) i++; continue; }
        return { sub: a, rest: args.slice(i + 1) };
    }
    return { sub: undefined, rest: [] };
}

const NONE = new Set();

/**
 * Flags of a getopt-style argv: short chars (a cluster stops at a valued
 * char, whose value is the rest of the cluster or the next token), long flag
 * names (valued ones without `=` consume the next token), and the index of
 * the first operand (-1 if none).
 */
export function scanFlags(args, valued = '', valuedLong = NONE) {
    const chars = new Set();
    const longs = new Set();
    let operand = -1;
    for (let i = 0; i < args.length; i++) {
        const t = args[i];
        if (t === '--') {
            if (operand < 0 && i + 1 < args.length) operand = i + 1;
            break;
        }
        if (t.startsWith('--')) {
            const name = t.split('=', 1)[0];
            longs.add(name);
            if (!t.includes('=') && valuedLong.has(name)) i++;
        } else if (t.length > 1 && t[0] === '-') {
            for (let k = 1; k < t.length; k++) {
                chars.add(t[k]);
                if (valued.includes(t[k])) {
                    if (k === t.length - 1) i++;
                    break;
                }
            }
        } else if (operand < 0) {
            operand = i;
        }
    }
    return { chars, longs, operand };
}

export const GIT_VALUED = /^(?:-C|-c|--git-dir|--work-tree|--namespace|--exec-path)$/;
export const git = (args) => positional(args, GIT_VALUED);
// git rebase short clusters: -s/-S/-C/-X/-x take the rest of the cluster as their
// value, so -i/-x only count before one of them (-ki, -kx cmd; not -Xtheirs, -sx).
export const REBASE_I = /^-[a-rt-wyzA-BD-RT-WYZ]*i/;
export const REBASE_X = /^-[a-rt-wyzA-BD-RT-WYZ]*x/;

// ---- segments and pipelines ------------------------------------------------

/** Segments nested (at any depth) under seg, via the lexer's children links. */
export function descendants(seg) {
    const out = [];
    const stack = [seg];
    while (stack.length) {
        for (const c of stack.pop().children) {
            out.push(c);
            stack.push(c);
        }
    }
    return out;
}

// Per parse: pipeline id -> { pipe: stages in order, memo }, and seg -> its stage.
const PIPES = new WeakMap();

/** The pipeline seg belongs to: { pipe, at, memo }. Built once per parse. */
export function pipeStage(seg, segs) {
    let idx = PIPES.get(segs);
    if (!idx) {
        const byPipe = new Map();
        const at = new Map();
        for (const s of segs) {
            let p = byPipe.get(s.pipeline);
            if (!p) byPipe.set(s.pipeline, (p = { pipe: [], memo: new Map() }));
            at.set(s, p.pipe.length);
            p.pipe.push(s);
        }
        idx = { byPipe, at };
        PIPES.set(segs, idx);
    }
    const p = idx.byPipe.get(seg.pipeline);
    return { pipe: p.pipe, at: idx.at.get(seg), memo: p.memo };
}

/** Index of the first stage matching pred (memoized per pipeline under key), -1 if none. */
export function firstStage(st, key, pred) {
    if (!st.memo.has(key)) st.memo.set(key, st.pipe.findIndex(pred));
    return st.memo.get(key);
}

/** Index of the last stage matching pred (memoized per pipeline under key), -1 if none. */
export function lastStage(st, key, pred) {
    if (!st.memo.has(key)) st.memo.set(key, st.pipe.findLastIndex(pred));
    return st.memo.get(key);
}

// Per parse: memoized whole-command facts.
const FACTS = new WeakMap();
/** Whether any segment of the parse matches pred (memoized per parse under key). */
export function anySeg(segs, key, pred) {
    let m = FACTS.get(segs);
    if (!m) FACTS.set(segs, (m = new Map()));
    if (!m.has(key)) m.set(key, segs.some(pred));
    return m.get(key);
}

// Wrappers that run their command repeatedly ('per-item': find -exec,
// git rebase --exec, git submodule foreach, git bisect run).
export const FAN_OUT = new Set(['xargs', 'parallel', 'watch', 'entr', 'per-item']);

/** gh run in a loop, a fan-out wrapper, after `seq |`, or before `| parallel`. */
export function ghInFanOut(seg, segs) {
    if (seg.inLoop || seg.wrappers.some((w) => FAN_OUT.has(w))) return true;
    const st = pipeStage(seg, segs);
    const seq = firstStage(st, 'seq', (s) => s.argv[0] === 'seq');
    const par = lastStage(st, 'parallel', (s) => s.argv[0] === 'parallel' || s.wrappers.includes('parallel'));
    return (seq >= 0 && seq < st.at) || par > st.at;
}

// ---- inline interpreter code -----------------------------------------------

// rmtree/rimraf/rm_rf/remove_tree, or fs.rm(Sync)/rmdir(Sync)/Deno.remove(Sync)(…recursive…).
// (mkdirSync(…{recursive:true}) is not a delete.) The gap is bounded so a long
// input cannot backtrack quadratically.
const SCRIPT_DELETE = /rmtree|rimraf|\brm_rf?\b|remove_dir|remove_tree|os\.removedirs|\b(?:rm(?:dir)?|remove)(?:Sync)?\s*\([^;]{0,200}?recursive/;
// Split code into shell-ish words: `os.system('rm -Rf x')`, `['rm', '-rf', 'x']`,
// `execSync("rm --recursive x")` all yield rm followed by its flags.
const CODE_WORD_SEP = /[\s'"`,()[\]{};]+/;

/** A shelled-out rm whose flags include a short cluster with r/R or --recursive. */
function shellRmRecursive(code) {
    const t = code.split(CODE_WORD_SEP);
    for (let i = 0; i < t.length; i++) {
        if (t[i] !== 'rm' && !t[i].endsWith('/rm')) continue;
        for (let j = i + 1; j < t.length && t[j].startsWith('-'); j++) {
            if (/^-[a-zA-Z]*[rR]/.test(t[j]) || t[j] === '--recursive') return true;
        }
    }
    return false;
}

/** A shelled-out `find … -delete` (within one `;`/newline-separated statement). */
function shellFindDelete(code) {
    return code.split(/[;\n]/).some((p) => {
        const f = p.search(/\bfind\b/);
        return f >= 0 && /\s-delete\b/.test(p.slice(f));
    });
}

/** Inline code that deletes recursively. Linear in the code length. */
export const scriptDeletes = (code) => SCRIPT_DELETE.test(code) || shellFindDelete(code) || shellRmRecursive(code);

// Per interpreter: flags whose next argument is inline code, and flags that
// take a (non-code) value. Scanning stops at the first positional (a script
// file and its arguments) or at python's -m (a module and its arguments).
const INTERP = {
    python: { code: /^-[a-ln-zA-VYZ]*c$/, valued: /^-[WXQ]$/, stop: /^-[abd-zA-VYZ]*m/ }, // -m, -Bm; not -c'import …'
    node: { code: /^(?:-[a-zA-Z]*[ep]|--eval|--print)$/,
        valued: /^(?:-r|--require|--import|--loader|--experimental-loader|-C|--conditions|--env-file|--input-type|-P|--project|-O|--compiler-options|--tsconfig)$/ },
    perl: { code: /^-[a-zA-Z0-9:.]*[eE]$/, valued: /^-[Ix]$/ },
    ruby: { code: /^-[a-zA-Z]*e$/, valued: /^-[Ir]$/ },
    deno: { code: /^--eval$/, valued: /^$/ },
};
export const INTERP_OF = { python: 'python', python3: 'python', node: 'node', tsx: 'node', 'ts-node': 'node', bun: 'node',
    perl: 'perl', ruby: 'ruby', deno: 'deno' };
const FEEDERS = new Set(['echo', 'printf', 'cat']);

/**
 * The inline code an interpreter runs: its option tokens (so glued forms like
 * -c'…' are seen) plus the argument of a code flag (-c/-e/--eval…), a
 * here-string and the heredoc body. `stdin` is true when it reads its program
 * from stdin (no code flag, script file or python -m module). Arguments of a
 * script file or module are not code.
 */
export function interpreterProgram(a, s) {
    const spec = INTERP[INTERP_OF[s.argv[0]]];
    const parts = [];
    let fromArgs = false; // program given by a code flag or a script file/module
    if (s.argv[0] === 'deno' && a[0] === 'eval') {
        parts.push(...a.slice(1));
        fromArgs = true;
    } else {
        for (let i = 0; i < a.length; i++) {
            const t = a[i];
            if (t === '--' || t.startsWith('<')) break;
            if (spec.stop && spec.stop.test(t) && !spec.code.test(t)) { fromArgs = true; break; }
            if (!t.startsWith('-') || t === '-') { fromArgs = t !== '-'; break; }
            parts.push(t);
            const eq = /^--(?:eval|print)=/.exec(t);
            if (eq) fromArgs = true;
            else if (spec.code.test(t)) { if (a[i + 1] != null) parts.push(a[i + 1]); fromArgs = true; i++; }
            else if (spec.valued.test(t)) i++;
        }
    }
    a.forEach((t, k) => {
        if (t === '<<<' && a[k + 1] != null) parts.push(a[k + 1]);
        else if (t.startsWith('<<<')) parts.push(t.slice(3));
    });
    if (s.heredoc != null) parts.push(s.heredoc);
    return { code: parts.join('\n'), stdin: !fromArgs };
}

/**
 * Whether the inline code of interpreter segment s matches test: its own code,
 * or (when it reads its program from stdin) what an earlier echo/printf/cat
 * stage of its pipeline prints. Feeder checks are memoized per pipeline.
 */
export function interpreterRuns(a, s, segs, key, test) {
    const prog = interpreterProgram(a, s);
    if (test(prog.code)) return true;
    if (!prog.stdin) return false;
    const st = pipeStage(s, segs);
    const k = firstStage(st, key, (x) => FEEDERS.has(x.argv[0]) && test(x.argv.slice(1).join(' ') + '\n' + (x.heredoc ?? '')));
    return k >= 0 && k < st.at;
}

// ---- paths -----------------------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The home directory as written in a command: ~, $HOME, ${HOME} or the absolute path. */
export const HOME = String.raw`(?:~|\$HOME|\$\{HOME\}|${escapeRe(homedir())})`;

// Credential files, matched as a path suffix with or without a home prefix
// (`~/.npmrc`, `$HOME/.npmrc`, `../../.npmrc`, `.npmrc` after `cd ~`).
// SSH private keys: ~/.ssh/id_* except *.pub, and bare id_<type> after `cd ~/.ssh`.
const CRED_SUFFIX = [
    String.raw`\.claude\.json`, String.raw`\.claude-code-fast-permission-hook/config\.json`, String.raw`\.config/gh/hosts\.yml`,
    String.raw`\.npmrc`, String.raw`\.pypirc`, String.raw`\.docker/config\.json`, String.raw`\.kube/config`,
    String.raw`\.claude/\.credentials\.json`, String.raw`\.aws/credentials`, String.raw`\.netrc`, String.raw`\.git-credentials`,
    String.raw`\.ssh/id_[\w.-]*(?<!\.pub)`, String.raw`id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?`,
].join('|');
const ETC_SECRET = String.raw`(?:/private)?/etc/(?:sudoers|master\.passwd)`;
// Home-anchored credential files also match as a prefix (`~/.claude.json.backup`, `~/.netrc.old`).
const HOME_CRED = String.raw`\.claude\.json|\.claude-code-fast-permission-hook/config\.json|\.config/gh/hosts\.yml|\.npmrc|\.pypirc`
    + String.raw`|\.docker/config\.json|\.kube/config|\.claude/\.credentials\.json|\.aws/credentials|\.netrc|\.git-credentials`;
const CRED_ARG = new RegExp(String.raw`(?:^|[/=<])(?:${CRED_SUFFIX})$|^<?${ETC_SECRET}|^(?:[<=]|--?[\w-]+=)?${HOME}/(?:${HOME_CRED})`);
const CRED_TEXT = new RegExp(String.raw`(?:^|[^\w.-])(?:${CRED_SUFFIX}|${ETC_SECRET})(?![\w.-])`);

/** An argument naming a credential file (a path, `<path`, or `--flag=path`). */
export const credArg = (t) => CRED_ARG.test(t);
/** Code or text that mentions a credential file path. */
export const credText = (t) => CRED_TEXT.test(t);
