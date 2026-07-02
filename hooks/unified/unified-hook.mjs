#!/usr/bin/env node
/**
 * Unified Claude Code Hook System
 * 
 * Entry point that routes to different modules based on event type.
 * Implements "Memento architecture" - maintains perfect memory while Claude's context compacts.
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
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

/**
 * Append one line per fatal error to ~/.claude/hooks/unified/logs/errors.log
 * so silent hook deaths are diagnosable. Never throws (logging must not block
 * the exit path).
 */
function logFatal(eventType, err) {
    try {
        const logDir = join(process.env.HOME || '.', '.claude', 'hooks', 'unified', 'logs');
        mkdirSync(logDir, { recursive: true });
        const line = `${new Date().toISOString()} ${eventType || 'unknown'} ${err?.message || String(err)}\n`;
        appendFileSync(join(logDir, 'errors.log'), line);
    } catch (_) { /* never block exit on logging */ }
}

// Lazy load modules
async function loadModule(name) {
    return import(`./modules/${name}.mjs`);
}

async function main() {
    // Recursion guard: llm-call.mjs spawns a headless `claude -p` with this
    // flag set. That spawned CLI runs the user's hooks too — it must never
    // re-enter this pipeline (infinite hook→LLM→hook recursion).
    if (process.env.CLAUDE_HOOK_LLM_SPAWNED === '1') {
        process.exit(0);
    }

    try {
        // Read hook input
        const input = readFileSync(0, 'utf-8');
        const event = JSON.parse(input);

        const eventType = process.argv[2]; // prompt, precompact, post-edit, stop, session-start

        if (!eventType) {
            console.error('[UnifiedHook] No event type specified');
            process.exit(0);
        }

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
                const editWarning = await modules[3].checkEditHistory(event, config);
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

                // Deterministic auto-distillation: write high-confidence typed
                // memory (test_command, failure_pattern) straight from the event
                // ledger — no LLM, no API key, runs every compaction. Done BEFORE
                // the reducer, which prunes the ledger after writing its
                // checkpoint. The nuanced distillation is done in-process by the
                // main model via the post-compaction SessionStart nudge
                // (distill-nudge.mjs).
                if (puntax.eventLedger.enabled) {
                    const auto = await loadModule('auto-distill');
                    auto.runAutoDistill(event, { projectDir: process.env.CLAUDE_PROJECT_DIR || null });
                }

                const reducer = await loadModule('precompact-reducer');
                const checkpoint = await reducer.runReducer(event, config);

                // Legacy full-transcript LLM summary: only when explicitly opted
                // in via PUNTAX_PRECOMPACT_MODE=llm (v1 narrative memory). Default
                // is now 'deterministic', so this path is off unless requested.
                if (puntax.precompact.mode === 'llm') {
                    const module = await loadModule('precompact-llm');
                    await module.runPreCompact(event, config);
                }

                // External-LLM distillation via headless `claude -p`: on by
                // default (PUNTAX_LLM_DISTILLATION overrides), threshold-gated,
                // checkpoint-based. No API key needed — the CLI uses the
                // user's Claude auth.
                if (puntax.llmDistillation.enabled) {
                    const distill = await loadModule('distill-precompact');
                    await distill.runDistill(event, config, null, { checkpoint });
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
                await modules[1].logOperation(event, config);

                // Emit impact hint for high-impact paths (printed to stdout so
                // it surfaces as PostToolUse additional context).
                try {
                    const hint = await modules[2].emitHint(event, config);
                    if (hint) console.log(hint);
                } catch (e) {
                    if (process.env.DEBUG) console.error('[impact-hint]', e);
                }

                // Read-only lint of the edited file: surface issues + nudge the
                // agent to fix them (incl. pre-existing). Never mutates; silent
                // in projects without a configured linter.
                try {
                    const lintReport = modules[0].lintFile(event, config, { projectDir: event.cwd });
                    if (lintReport) console.log(lintReport);
                } catch (e) {
                    if (process.env.DEBUG) console.error('[lint]', e);
                }

                // Steering: tick refactor-manifest items for the edited file and
                // warn when the edit lands outside the charter scope. Silent
                // when no charter/manifest exists.
                try {
                    const steering = await loadModule('steering');
                    const steerNote = steering.postEditSteering(event);
                    if (steerNote) console.log(steerNote);
                } catch (e) {
                    if (process.env.DEBUG) console.error('[steering]', e);
                }
                break;
            }

            case 'post-tool': {
                // PostToolUse on ALL tools: log only (no format-lint)
                // Skip Write|Edit — already logged by post-edit handler
                if (event.tool_name === 'Write' || event.tool_name === 'Edit') break;
                const logModule = await loadModule('rolling-log');
                await logModule.logOperation(event, config);
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

                // Export-surface tripwire: warn when this session's edits
                // removed/renamed public exports relative to the session's git
                // baseline. Silent for non-git projects.
                try {
                    const surface = await loadModule('export-surface');
                    const apiWarning = surface.diffExportSurface(event);
                    if (apiWarning) console.log(apiWarning);
                } catch (e) {
                    if (process.env.DEBUG) console.error('[export-surface]', e);
                }

                // Flaky-test ledger: flag tests run this session whose outcomes
                // flip across sessions — don't trust a single pass/fail.
                try {
                    const flaky = await loadModule('flaky-tests');
                    const flakyReport = flaky.buildFlakyReport(
                        process.env.CLAUDE_PROJECT_DIR || event.cwd || null,
                        event.session_id,
                    );
                    if (flakyReport) console.log(flakyReport);
                } catch (e) {
                    if (process.env.DEBUG) console.error('[flaky-tests]', e);
                }
                break;
            }

            case 'session-start': {
                // SessionStart: git status + project context
                const module = await loadModule('session-start');
                const output = await module.injectContext(event, config);

                // Pin the git baseline for the export-surface tripwire (no-op
                // on compaction — the session keeps its original pin).
                try {
                    const surface = await loadModule('export-surface');
                    surface.recordBaseline(event);
                } catch (e) {
                    if (process.env.DEBUG) console.error('[export-surface]', e);
                }

                const parts = [];
                if (output) parts.push(output);

                // Post-compaction in-process distillation nudge: when this
                // SessionStart follows a compaction, inject the deterministic
                // checkpoint facts + a memory_write instruction so the main
                // (in-process, cache-warm) model distills durable lessons for
                // free — no external LLM. Gated on the event ledger substrate.
                if (event.source === 'compact') {
                    const { readPuntaxConfig } = await loadModule('puntax-config');
                    const puntax = readPuntaxConfig(config, process.env);
                    if (puntax.eventLedger.enabled) {
                        const nudgeMod = await loadModule('distill-nudge');
                        const nudge = nudgeMod.buildCompactionNudge(process.env.CLAUDE_PROJECT_DIR || null);
                        if (nudge) parts.push(nudge);
                    }

                    // Steering: re-inject the mission charter VERBATIM plus the
                    // remaining refactor-manifest items — the anti-drift anchor
                    // for very long sessions. Independent of the event ledger.
                    try {
                        const steering = await loadModule('steering');
                        const anchor = steering.buildSteeringInjection(process.env.CLAUDE_PROJECT_DIR || event.cwd || null);
                        if (anchor) parts.push(anchor);
                    } catch (e) {
                        if (process.env.DEBUG) console.error('[steering]', e);
                    }
                }

                if (parts.length) console.log(parts.join('\n\n'));
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
        // Per-module errors above fail open; only a FATAL pipeline error lands
        // here. Log it and exit 1 — in Claude Code hooks only exit 2 blocks the
        // operation; other non-zero exits are non-blocking (stderr surfaced).
        logFatal(process.argv[2], err);
        process.exit(1);
    }
}

main().catch((err) => {
    logFatal(process.argv[2], err);
    process.exit(1);
});
