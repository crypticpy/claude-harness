/**
 * Shared LLM Call Utility
 * Single implementation of the OpenAI-compatible API call pattern
 * used by session-memory, trace-diagnosis, and rolling-log modules.
 */

/**
 * Call an OpenAI-compatible LLM endpoint.
 *
 * @param {string} apiKey - API key for the provider
 * @param {object} llmConfig - Config object with { baseUrl, model, maxTokens }
 * @param {string} prompt - The user message to send
 * @param {object} [options] - Optional settings
 * @param {number} [options.timeoutMs=30000] - Abort after this many ms (0 = no timeout)
 * @param {string} [options.title='Claude Code Hook'] - X-Title header value
 * @param {number} [options.temperature=0.3] - LLM temperature
 * @param {'json'|'text'} [options.format='json'] - 'json' extracts first JSON object, 'text' returns raw content
 * @returns {Promise<object|string|null>} Parsed JSON object, raw text, or null on failure
 */
export async function callLlm(apiKey, llmConfig, prompt, options = {}) {
    const {
        timeoutMs = 30_000,
        title = 'Claude Code Hook',
        temperature = 0.3,
        format = 'json',
    } = options;

    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
        const response = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
            method: 'POST',
            signal: controller?.signal,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/anthropics/claude-code',
                'X-Title': title,
            },
            body: JSON.stringify({
                model: llmConfig.model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: llmConfig.maxTokens || 2000,
                temperature,
            }),
        });

        if (!response.ok) {
            throw new Error(`LLM request failed: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        if (format === 'text') {
            return content.trim() || null;
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
