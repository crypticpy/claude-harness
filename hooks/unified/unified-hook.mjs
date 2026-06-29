#!/usr/bin/env node
/**
 * Unified Claude Code Hook System
 * 
 * Entry point that routes to different modules based on event type.
 * Implements "Memento architecture" - maintains perfect memory while Claude's context compacts.
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load config
const configPath = join(__dirname, 'config.json');
let config = {};
if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
}

// Shared API key resolution
import { getApiKey } from './modules/api-key.mjs';

// Lazy load modules
async function loadModule(name) {
    return import(`./modules/${name}.mjs`);
}

async function main() {
    try {
        // Read hook input
        const input = readFileSync(0, 'utf-8');
        const event = JSON.parse(input);
        
        const eventType = process.argv[2]; // prompt, precompact, post-edit, stop, session-start
        
        if (!eventType) {
            console.error('[UnifiedHook] No event type specified');
            process.exit(0);
        }

        const apiKey = getApiKey();

        switch (eventType) {
            case 'prompt': {
                // UserPromptSubmit: context-report + skill-activation + session-memory inject + edit-history
                const modules = await Promise.all([
                    loadModule('context-report'),
                    loadModule('skill-activation'),
                    loadModule('session-memory'),
                    loadModule('edit-history')
                ]);

                const outputs = [];
                
                // Context report
                const contextReport = await modules[0].reportContext(event, config);
                if (contextReport) outputs.push(contextReport);

                // Skill activation
                const skillCheck = await modules[1].checkSkills(event, config);
                if (skillCheck) outputs.push(skillCheck);

                // Session memory injection (after compaction; PUNTAX-gated)
                const memory = await modules[2].injectMemory(event, config);
                if (memory) outputs.push(memory);

                // Edit history warnings (if file being discussed was edited before)
                const editWarning = await modules[3].checkEditHistory(event, config, apiKey);
                if (editWarning) outputs.push(editWarning);

                if (outputs.length > 0) {
                    console.log(outputs.join('\n\n'));
                }
                break;
            }

            case 'precompact': {
                // PreCompact: always write a deterministic checkpoint (no LLM, no
                // API key needed). v2 default is no routine LLM call.
                const { readPuntaxConfig } = await loadModule('puntax-config');
                const puntax = readPuntaxConfig(config, process.env);

                const reducer = await loadModule('precompact-reducer');
                const checkpoint = await reducer.runReducer(event, config);

                // Legacy full-transcript LLM summary: only when explicitly opted
                // in via PUNTAX_PRECOMPACT_MODE=llm (v1 narrative memory). Default
                // is now 'deterministic', so this path is off unless requested.
                if (puntax.precompact.mode === 'llm') {
                    const module = await loadModule('precompact-llm');
                    await module.runPreCompact(event, config, apiKey);
                }

                // Threshold-gated typed-memory distillation: only when a session
                // signal trips a threshold AND PUNTAX_LLM_DISTILLATION is on
                // (default off). Consumes the checkpoint, not the raw transcript.
                if (puntax.llmDistillation.enabled) {
                    const distill = await loadModule('distill-precompact');
                    await distill.runDistill(event, config, apiKey, { checkpoint });
                }
                break;
            }

            case 'post-edit': {
                // PostToolUse on Write|Edit: format + log operation + impact hint
                const modules = await Promise.all([
                    loadModule('format-lint'),
                    loadModule('rolling-log'),
                    loadModule('impact-hint')
                ]);

                // Format code
                await modules[0].formatFile(event, config);

                // Log the operation
                await modules[1].logOperation(event, config, apiKey);

                // Emit impact hint for high-impact paths (printed to stdout so
                // it surfaces as PostToolUse additional context).
                try {
                    const hint = await modules[2].emitHint(event, config);
                    if (hint) console.log(hint);
                } catch (e) {
                    if (process.env.DEBUG) console.error('[impact-hint]', e);
                }
                break;
            }

            case 'post-tool': {
                // PostToolUse on ALL tools: log only (no format-lint)
                // Skip Write|Edit — already logged by post-edit handler
                if (event.tool_name === 'Write' || event.tool_name === 'Edit') break;
                const logModule = await loadModule('rolling-log');
                await logModule.logOperation(event, config, apiKey);
                break;
            }

            case 'stop': {
                // Stop: quality gates + verification check
                const [gatesModule, verifyModule] = await Promise.all([
                    loadModule('quality-gates'),
                    loadModule('verification-check')
                ]);
                await gatesModule.runGates(event, config);
                const verifyOutput = await verifyModule.runVerification(event, config);
                if (verifyOutput) console.log(verifyOutput);
                break;
            }

            case 'session-start': {
                // SessionStart: git status + project context
                const module = await loadModule('session-start');
                const output = await module.injectContext(event, config);
                if (output) console.log(output);
                break;
            }

            case 'retrospective': {
                // Deep retrospective: cross-session analysis of all history
                const retroModule = await loadModule('deep-retrospective');
                const retroResult = await retroModule.retrospective(config);
                console.log(JSON.stringify(retroResult, null, 2));
                break;
            }

            case 'evolve': {
                // Self-evolution: aggregate lessons and propose improvements
                const evolveModule = await loadModule('self-evolution');
                const result = await evolveModule.evolve(config);
                console.log(JSON.stringify(result, null, 2));
                break;
            }

            default:
                console.error(`[UnifiedHook] Unknown event type: ${eventType}`);
        }

        process.exit(0);

    } catch (err) {
        if (process.env.DEBUG) {
            console.error('[UnifiedHook] Error:', err);
        }
        process.exit(0); // Fail gracefully
    }
}

main().catch(() => process.exit(0));
