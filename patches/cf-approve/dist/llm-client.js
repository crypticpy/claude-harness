import OpenAI from 'openai';
import { loadConfig, getApiKey } from './config.js';
import { LLMResponseSchema } from './types.js';
export async function queryLLM(toolName, toolInput, cwd) {
    const config = loadConfig();
    const apiKey = getApiKey();
    if (!apiKey) {
        // No API key, conservative deny
        return {
            decision: 'deny',
            reason: 'No LLM API key configured - cannot make intelligent decision',
            isError: true,
        };
    }
    const client = new OpenAI({
        apiKey,
        baseURL: config.llm.baseUrl,
    });
    // Use configurable system prompt from config
    const systemPrompt = config.llm.systemPrompt;
    const userPrompt = `Evaluate this tool request for auto-approval:

Tool: ${toolName}
Working Directory: ${cwd || 'unknown'}
Input: ${JSON.stringify(toolInput, null, 2)}

Should this be automatically approved or denied?`;
    try {
        const response = await client.chat.completions.create({
            model: config.llm.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0,
            max_tokens: 200,
            response_format: { type: 'json_object' },
        });
        const content = response.choices[0]?.message?.content;
        if (!content) {
            return {
                decision: 'deny',
                reason: 'Empty LLM response',
                isError: true,
            };
        }
        // Parse and validate response
        const parsed = JSON.parse(content);
        return LLMResponseSchema.parse(parsed);
    }
    catch (error) {
        // isError marks this as an infrastructure failure, not a verdict:
        // the handler passes these through to the native dialog uncached.
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
            decision: 'deny',
            reason: `LLM error: ${message}`,
            isError: true,
        };
    }
}
//# sourceMappingURL=llm-client.js.map