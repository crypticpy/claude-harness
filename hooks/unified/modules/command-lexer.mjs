/**
 * Minimal quote-aware shell lexer for the command-redirect PreToolUse hook.
 *
 * Splits a Bash command into simple-command segments so rules can look at
 * the command actually being run (argv[0]) instead of raw text: `echo "rm -rf
 * x"` is an echo, `grep -rn "rm -rf" .` is a grep. It is not a full shell
 * parser; it handles what agents actually write:
 *   - ; && || | & newline ( ) as separators (pipes keep the pipeline id)
 *   - '...' and "..." quoting, backslash escapes, # comments
 *   - $(...), `...`, <(...) substitutions -> parsed as nested commands
 *   - commands run by another command (sh -c, eval, git rebase --exec,
 *     git -c alias.x=!…, find -exec, watch, npx/uv run/pnpm dlx …; see
 *     command-nesting.mjs) -> parsed as nested commands
 *   - heredocs: body skipped, or parsed when fed to a shell, or attached to
 *     the segment (seg.heredoc) for interpreter rules
 *   - for/while/until ... done nesting -> seg.inLoop
 *   - leading keywords (do/then/if/!), VAR=value prefixes and wrappers are
 *     stripped; fan-out wrappers are recorded in seg.wrappers
 *
 * Each segment: { argv, raw, inLoop, wrappers, pipeline, heredoc, parent, children }.
 * argv[0] is the command name (`/bin/rm` -> `rm`, `rimraf@5` -> `rimraf`); argv may be empty. `parent` is
 * the segment whose command runs this one (null at top level).
 */

import { commandName, stripWrappers, nestedCommands, TOO_DEEP } from './command-nesting.mjs';

const LOOP_START = new Set(['for', 'while', 'until', 'select']);
const LEAD_KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', '!', '{', '}', 'fi', 'esac', 'done']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const MAX_DEPTH = 8;
export { TOO_DEEP };

/**
 * Push the segment for one simple command, then the segments of every
 * command it runs (wrappers' targets, sh -c strings, git --exec, find -exec…),
 * each with `parent` pointing at it.
 */
function emitArgv(words, raw, c, out, state) {
    const wrappers = [...c.wrappers];
    const nested = [];
    const argv = stripWrappers(words, wrappers, nested);
    if (argv.length) argv[0] = commandName(argv[0]);
    const seg = addSeg(out, { argv, raw, inLoop: c.inLoop, wrappers, pipeline: c.pipeline, heredoc: null, parent: c.parent });
    const perItem = argv.length > 0 && nestedCommands(argv, nested);
    const child = { inLoop: c.inLoop, wrappers: perItem ? [...wrappers, 'per-item'] : wrappers, depth: c.depth + 1, parent: seg };
    for (const item of nested) {
        if (typeof item === 'string') lexInto(item, out, child, state);
        else if (item.length && child.depth > MAX_DEPTH) tooDeep(item.join(' '), out, child, state);
        else if (item.length) emitArgv(item, item.join(' '), { ...child, pipeline: ++state.pipeline }, out, state);
    }
    return seg;
}

function tooDeep(src, out, c, state) {
    addSeg(out, { argv: [TOO_DEEP], raw: src, inLoop: c.inLoop, wrappers: c.wrappers, pipeline: ++state.pipeline, heredoc: null, parent: c.parent });
}

/** Append a segment and link it into its parent's `children`. */
function addSeg(out, seg) {
    seg.children = [];
    if (seg.parent) seg.parent.children.push(seg);
    out.push(seg);
    return seg;
}

/** Index of the `)` closing a `(` whose body starts at `start`. */
function matchClose(src, start) {
    let depth = 1;
    for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (c === '\\') { i++; continue; }
        if (c === "'") { const j = src.indexOf("'", i + 1); i = j < 0 ? src.length : j; continue; }
        if (c === '"') {
            for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === '\\') i++;
            continue;
        }
        if (c === '(') depth++;
        else if (c === ')' && --depth === 0) return i;
    }
    return src.length;
}

function findBacktick(src, start) {
    for (let i = start; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === '`') return i;
    }
    return src.length;
}

function lexInto(src, out, parent, state) {
    // Deeper than any real command: emit a placeholder a rule denies, so
    // stacking wrappers cannot hide the inner command.
    if (parent.depth > MAX_DEPTH) return tooDeep(src, out, parent, state);
    const n = src.length;
    let loopDepth = 0;
    let pipeline = ++state.pipeline;
    let words = [];
    let word = '';
    let inWord = false;
    let segStart = 0;
    let lineSegs = []; // segments emitted at this level on the current line (heredoc owners)
    let pending = []; // heredocs opened on the current line

    // Context for a $(…)/<(…)/`…` inside the current command. `done < <(gh …)`
    // runs once, after the loop; `while [ "$(gh …)" ]` runs every iteration.
    const ctx = () => {
        let depth = loopDepth;
        let k = 0;
        for (; k < words.length && LEAD_KEYWORDS.has(words[k]); k++) if (words[k] === 'done') depth--;
        const loopHeader = words[k] === 'while' || words[k] === 'until';
        return {
            inLoop: parent.inLoop || depth > 0 || loopHeader,
            wrappers: parent.wrappers,
            depth: parent.depth + 1,
            parent: parent.parent,
        };
    };
    const sub = (text) => lexInto(text, out, ctx(), state);
    const endWord = () => {
        if (inWord) words.push(word);
        word = '';
        inWord = false;
    };
    const emit = (end) => {
        endWord();
        let w = words;
        words = [];
        const raw = src.slice(segStart, end).trim();
        // Leading keywords first (`do for …`, `then while …`), closing loops on `done`.
        while (w.length && LEAD_KEYWORDS.has(w[0])) {
            if (w[0] === 'done') loopDepth = Math.max(0, loopDepth - 1);
            w = w.slice(1);
        }
        let inLoop = parent.inLoop || loopDepth > 0;
        if (w.length && LOOP_START.has(w[0])) {
            loopDepth++;
            inLoop = true;
            w = w[0] === 'for' || w[0] === 'select' ? [] : w.slice(1);
        }
        if (!w.length && !raw) return;
        lineSegs.push(emitArgv(w, raw, { inLoop, wrappers: parent.wrappers, depth: parent.depth, parent: parent.parent, pipeline }, out, state));
    };
    const separate = (end, newPipeline) => {
        emit(end);
        if (newPipeline) pipeline = ++state.pipeline;
    };
    // Consume heredoc bodies that start after the newline at index i.
    const readHeredocs = (i) => {
        const owners = lineSegs;
        for (const h of pending) {
            const bodyStart = i;
            let end = n;
            let next = n;
            let p = i;
            while (p < n) {
                const nl = src.indexOf('\n', p);
                const lineEnd = nl < 0 ? n : nl;
                let line = src.slice(p, lineEnd);
                if (h.strip) line = line.replace(/^\t+/, '');
                if (line === h.delim) { end = p; next = nl < 0 ? n : nl + 1; break; }
                p = lineEnd + 1;
            }
            const body = src.slice(bodyStart, Math.min(end, n));
            const shell = owners.find((s) => SHELLS.has(s.argv[0]) && !s.argv.slice(1).some((a) => /^-[a-zA-Z]*c/.test(a) || !a.startsWith('-')));
            if (shell) lexInto(body, out, { inLoop: shell.inLoop, wrappers: shell.wrappers, depth: parent.depth + 1, parent: shell }, state);
            else if (owners.length) owners[owners.length - 1].heredoc = body;
            i = next;
        }
        pending = [];
        lineSegs = [];
        return i;
    };

    let i = 0;
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (c === "'") {
            const j = src.indexOf("'", i + 1);
            const e = j < 0 ? n : j;
            word += src.slice(i + 1, e);
            inWord = true;
            i = e + 1;
        } else if (c === '"') {
            inWord = true;
            i++;
            while (i < n && src[i] !== '"') {
                if (src[i] === '\\' && '$`"\\\n'.includes(src[i + 1])) { word += src[i + 1]; i += 2; }
                else if (src[i] === '$' && src[i + 1] === '(') { const e = matchClose(src, i + 2); sub(src.slice(i + 2, e)); word += '$(...)'; i = e + 1; }
                else if (src[i] === '`') { const e = findBacktick(src, i + 1); sub(src.slice(i + 1, e)); word += '`...`'; i = e + 1; }
                else { word += src[i]; i++; }
            }
            i++;
        } else if (c === '\\') {
            if (d !== '\n' && d !== undefined) { word += d; inWord = true; }
            i += 2;
        } else if ((c === '$' || c === '<' || c === '>') && d === '(') {
            const e = matchClose(src, i + 2);
            sub(src.slice(i + 2, e));
            word += '$(...)';
            inWord = true;
            i = e + 1;
        } else if (c === '`') {
            const e = findBacktick(src, i + 1);
            sub(src.slice(i + 1, e));
            word += '`...`';
            inWord = true;
            i = e + 1;
        } else if (c === '#' && !inWord) {
            const nl = src.indexOf('\n', i);
            i = nl < 0 ? n : nl;
        } else if (c === ' ' || c === '\t') {
            endWord();
            i++;
        } else if (c === '\n') {
            separate(i, true);
            i = pending.length ? readHeredocs(i + 1) : i + 1;
            lineSegs = [];
            segStart = i;
        } else if (c === ';') {
            separate(i, true);
            i += d === ';' ? 2 : 1;
            segStart = i;
        } else if (c === '&' && (d === '>' || src[i - 1] === '>' || src[i - 1] === '<')) {
            word += c; // &> redirect, or the & in 2>&1
            inWord = true;
            i++;
        } else if (c === '&') {
            separate(i, true);
            i += d === '&' ? 2 : 1;
            segStart = i;
        } else if (c === '|') {
            separate(i, d === '|');
            i += d === '|' || d === '&' ? 2 : 1;
            segStart = i;
        } else if (c === '(' || c === ')') {
            separate(i, true);
            i++;
            segStart = i;
        } else if (c === '<' && d === '<' && src[i + 2] !== '<' && src[i - 1] !== '<') {
            endWord();
            let j = i + 2;
            const strip = src[j] === '-';
            if (strip) j++;
            while (src[j] === ' ' || src[j] === '\t') j++;
            let delim = '';
            if (src[j] === "'" || src[j] === '"') {
                const q = src[j];
                const e = src.indexOf(q, j + 1);
                delim = src.slice(j + 1, e < 0 ? n : e);
                j = e < 0 ? n : e + 1;
            } else {
                while (j < n && !/[\s;&|<>()]/.test(src[j])) delim += src[j++];
                delim = delim.replace(/\\/g, '');
            }
            if (delim) pending.push({ delim, strip });
            i = j;
        } else {
            word += c;
            inWord = true;
            i++;
        }
    }
    emit(n);
}

/** Parse a Bash command string into simple-command segments. */
export function parseCommand(cmd) {
    const out = [];
    if (typeof cmd === 'string' && cmd) {
        lexInto(cmd, out, { inLoop: false, wrappers: [], depth: 0, parent: null }, { pipeline: 0 });
    }
    return out;
}
