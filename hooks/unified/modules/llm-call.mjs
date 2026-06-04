/**
 * Shared LLM Call Utility
 * Single implementation of the OpenAI Responses API call pattern
 * used by the rolling-log, precompact, deep-retrospective, and self-evolution modules.
 */

/**
 * Extract the assistant's text from a Responses API result.
 * The Responses API returns an `output` array; visible text lives in the
 * `message` item's `content[]` entries of type `output_text`.
 *
 * @param {any} data - Parsed JSON body from POST /v1/responses
 * @returns {string} Concatenated output text (empty string if none)
 */
function extractResponsesText(data) {
    if (typeof data?.output_text === 'string' && data.output_text) {
        return data.output_text;
    }
    if (!Array.isArray(data?.output)) return '';
    let text = '';
    for (const item of data.output) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
            for (const part of item.content) {
                if (part?.type === 'output_text' && typeof part.text === 'string') {
                    text += part.text;
                }
            }
        }
    }
    return text;
}

/**
 * Call an OpenAI-compatible Responses API endpoint.
 *
 * @param {string} apiKey - API key for the provider
 * @param {object} llmConfig - Config object with { baseUrl, model, maxTokens, reasoningEffort }
 * @param {string} prompt - The user message to send (sent as the `input`)
 * @param {object} [options] - Optional settings
 * @param {number} [options.timeoutMs=30000] - Abort after this many ms (0 = no timeout)
 * @param {string} [options.title='Claude Code Hook'] - X-Title header value
 * @param {'json'|'text'} [options.format='json'] - 'json' extracts first JSON object, 'text' returns raw content
 * @returns {Promise<object|string|null>} Parsed JSON object, raw text, or null on failure
 */
export async function callLlm(apiKey, llmConfig, prompt, options = {}) {
    const {
        timeoutMs = 30_000,
        title = 'Claude Code Hook',
        format = 'json',
    } = options;

    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
        // Responses API body. GPT-5 reasoning models reject `temperature`; reasoning
        // and visible output share `max_output_tokens`, so callers budget for both.
        const body = {
            model: llmConfig.model,
            input: prompt,
            max_output_tokens: llmConfig.maxTokens || 2000,
        };
        if (llmConfig.reasoningEffort) {
            body.reasoning = { effort: llmConfig.reasoningEffort };
        }

        const response = await fetch(`${llmConfig.baseUrl}/responses`, {
            method: 'POST',
            signal: controller?.signal,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/anthropics/claude-code',
                'X-Title': title,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`LLM request failed: ${response.status}`);
        }

        const data = await response.json();
        const content = extractResponsesText(data).trim();
        if (!content) {
            return null; // e.g. status === 'incomplete' (ran out of tokens during reasoning)
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
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}
