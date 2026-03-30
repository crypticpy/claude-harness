/**
 * Shared API Key Resolution
 * Single source of truth for resolving LLM API keys across all hook modules.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Resolve API key from permission hook config or environment variables.
 * Priority: cf-approve config > OPENROUTER_API_KEY > OPENAI_API_KEY
 */
export function getApiKey() {
    const permHookConfig = join(process.env.HOME, '.claude-code-fast-permission-hook', 'config.json');
    if (existsSync(permHookConfig)) {
        try {
            const cfg = JSON.parse(readFileSync(permHookConfig, 'utf-8'));
            if (cfg.llm?.apiKey) return cfg.llm.apiKey;
        } catch (_) {}
    }
    return process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
}
