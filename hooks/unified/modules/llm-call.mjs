/**
 * Shared LLM Call Utility
 * Single implementation of the headless Claude CLI call pattern (`claude -p`)
 * used by the rolling-log, precompact, distill, deep-retrospective, and
 * self-evolution modules.
 *
 * Replaces the former OpenAI Responses API HTTP call. The CLI authenticates
 * with the user's existing Claude login, so no API key is needed — the
 * `apiKey` parameter is retained (and ignored) so all callers work unchanged.
 */

import { execFileSync } from 'node:child_process';

// The CLI has no max-output-tokens flag, so llmConfig.maxTokens is ADVISORY:
// it is forwarded best-effort via CLAUDE_CODE_MAX_OUTPUT_TOKENS, and the
// prompt itself is capped here so an oversized input can't blow the context
// window (~175K tokens at 4 chars/token, under haiku's 200K context).
const MAX_PROMPT_CHARS = 700_000;
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Call the headless Claude CLI (`claude -p`).
 *
 * There is a single prompt string by design: callers that used to have
 * system + user halves already concatenate into `prompt` before calling.
 *
 * @param {string|null} apiKey - IGNORED (kept for caller compatibility; the CLI uses the user's Claude auth)
 * @param {object} llmConfig - Config object with { engine, model, maxTokens }
 * @param {string} prompt - The full prompt to send on stdin
 * @param {object} [options] - Optional settings
 * @param {number} [options.timeoutMs=120000] - Kill the CLI after this many ms (0 = no timeout)
 * @param {string} [options.title] - IGNORED (legacy HTTP header value; accepted for caller compatibility)
 * @param {'json'|'text'} [options.format='json'] - 'json' extracts first JSON object, 'text' returns raw content
 * @param {Function} [options.exec] - Test seam: injectable execFileSync replacement
 * @returns {Promise<object|string|null>} Parsed JSON object, raw text, or null on failure (fail-open)
 */
export async function callLlm(apiKey, llmConfig, prompt, options = {}) {
    const {
        timeoutMs = DEFAULT_TIMEOUT_MS,
        format = 'json',
        exec = execFileSync,
    } = options;

    let input = String(prompt ?? '');
    if (input.length > MAX_PROMPT_CHARS) {
        input = input.slice(0, MAX_PROMPT_CHARS) + '\n...[TRUNCATED]';
    }

    const model = llmConfig?.model || 'haiku';
    const env = {
        ...process.env,
        // Recursion guard: unified-hook.mjs exits immediately when it sees this
        // flag, so a spawned headless claude never re-enters the hook pipeline.
        CLAUDE_HOOK_LLM_SPAWNED: '1',
    };
    if (llmConfig?.maxTokens) {
        env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(llmConfig.maxTokens);
    }

    let stdout;
    try {
        stdout = exec('claude', ['-p', '--model', model, '--output-format', 'text'], {
            input,
            env,
            encoding: 'utf-8',
            timeout: timeoutMs > 0 ? timeoutMs : undefined,
            maxBuffer: 32 * 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    } catch (err) {
        // Fail-open: CLI missing (ENOENT), timeout, or non-zero exit → null.
        if (process.env.DEBUG) {
            const why = err?.code === 'ENOENT'
                ? 'claude CLI not found on PATH'
                : (err?.message || String(err));
            process.stderr.write('[llm-call] claude -p failed: ' + why + '\n');
        }
        return null;
    }

    const content = String(stdout || '').trim();
    if (!content) {
        return null;
    }

    if (format === 'text') {
        return content;
    }

    // Extract first JSON object from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
    }

    return null;
}
