/**
 * Threshold-gated PreCompact distillation (Phase 5).
 *
 * This is the demoted successor to the routine LLM summarizer in
 * precompact-llm.mjs: instead of summarizing every compaction, it runs only
 * when the deterministic checkpoint + transcript signals trip a threshold
 * (docs/05), and it consumes the checkpoint + selected evidence — NOT the raw
 * transcript dump — to propose a few typed memories.
 *
 * Output is written to the typed memory store tagged
 * `confidence: "llm_distilled"`, `provenance.source: "llm"`. Invalid LLM output
 * is discarded (no poisoning). No API key / no config / no threshold trip are
 * all graceful no-ops.
 *
 * Dependencies (LLM call, memory writer, transcript parser) are injectable so
 * the gate + proposal handling are unit-testable against a mocked LLM.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseTranscript } from './precompact-llm.mjs';
import { callLlm } from './llm-call.mjs';
import {
  appendMemory as appendMemoryReal,
  projectIdFor,
  MEMORY_KINDS,
  MEMORY_SCOPES,
  MEMORY_SEVERITIES,
} from './memory-store.mjs';
import { buildMetrics, evaluateThresholds } from './distill-threshold.mjs';

// Re-export the canonical transcript parser so consumers can import it from the
// new module name as the legacy precompact-llm.mjs is demoted.
export { parseTranscript };

const MIN_TOOL_CALLS = 5;
const MAX_PROPOSALS = 8;

/** Compact prompt from checkpoint + selected evidence (no raw transcript). */
export function buildDistillPrompt(checkpoint, signals, reasons) {
  const cp = checkpoint || {};
  const lines = [
    'You are distilling a coding session into a few DURABLE, typed memories.',
    'Return ONLY JSON: {"memories":[{"kind","scope","text","severity"}]}.',
    `kind ∈ ${JSON.stringify(MEMORY_KINDS)}`,
    `scope ∈ ${JSON.stringify(MEMORY_SCOPES)}`,
    `severity ∈ ${JSON.stringify(MEMORY_SEVERITIES)}`,
    'Only include facts worth recalling in a future session (gotchas, decisions,',
    'failure patterns, conventions). Skip anything transient. Max 8 memories.',
    '',
    `Distillation triggered by: ${(reasons || []).join(', ') || 'n/a'}`,
    `Working files: ${JSON.stringify((cp.workingFiles || []).slice(0, 10))}`,
    `Changed files: ${JSON.stringify((cp.changedFiles || []).slice(0, 10))}`,
    `Failures: ${JSON.stringify((cp.failures || []).slice(0, 8))}`,
    `Open loops: ${JSON.stringify((cp.openLoops || []).slice(0, 8))}`,
    `Decisions: ${JSON.stringify((cp.decisions || []).slice(0, 8))}`,
    `Signals: ${JSON.stringify({
      toolErrors: signals?.toolErrors,
      retryPatterns: signals?.retryPatterns,
      explorationSpirals: signals?.explorationSpirals,
      permissionDenials: signals?.permissionDenials,
    })}`,
    `Recent errors: ${JSON.stringify((signals?.errorMessages || []).slice(0, 6))}`,
  ];
  return lines.join('\n');
}

/**
 * Coerce an LLM reply into validated memory-input proposals. Anything malformed
 * is dropped. Returns at most MAX_PROPOSALS entries.
 */
export function parseProposals(result, projectId, reasons) {
  const arr = Array.isArray(result)
    ? result
    : Array.isArray(result?.memories)
      ? result.memories
      : [];
  const out = [];
  for (const raw of arr) {
    if (out.length >= MAX_PROPOSALS) break;
    if (!raw || typeof raw !== 'object') continue;
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (!text || text.length > 4000) continue;
    if (!MEMORY_KINDS.includes(raw.kind)) continue;
    const scope = MEMORY_SCOPES.includes(raw.scope) ? raw.scope : 'project';
    const severity = MEMORY_SEVERITIES.includes(raw.severity) ? raw.severity : 'medium';
    out.push({
      projectId,
      kind: raw.kind,
      scope,
      text,
      severity,
      confidence: 'llm_distilled',
      provenance: {
        source: 'llm',
        notes: (reasons || []).join(',') || null,
      },
    });
  }
  return out;
}

function readSignals(event, parse) {
  const { transcript_path } = event || {};
  if (!transcript_path || !existsSync(transcript_path)) return null;
  try {
    const transcript = readFileSync(transcript_path, 'utf-8');
    return parse(transcript, null).signals;
  } catch {
    return null;
  }
}

/**
 * Threshold-gated distillation entry. Returns a result object describing what
 * happened (for logging/tests); never throws.
 *
 * @param {object} event   PreCompact hook event ({ session_id, transcript_path })
 * @param {object} config  full unified-hook config
 * @param {string|null} apiKey
 * @param {object} opts    { checkpoint, force?, projectDir?, thresholds?,
 *                           deps?: { callLlm, appendMemory, parseTranscript } }
 */
export async function runDistill(event, config = {}, apiKey = null, opts = {}) {
  try {
    const deps = opts.deps || {};
    const parse = deps.parseTranscript || parseTranscript;
    const appendMemory = deps.appendMemory || appendMemoryReal;
    const llm = deps.callLlm || callLlm;

    const projectDir = resolve(opts.projectDir || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const checkpoint = opts.checkpoint || null;

    const signals = readSignals(event, parse) || {};
    if ((signals.totalToolCalls || 0) < MIN_TOOL_CALLS && !opts.force) {
      return { distilled: false, reason: 'too-short', reasons: [] };
    }

    const thresholds = opts.thresholds || config.puntax?.precompact?.thresholds || {};
    const metrics = buildMetrics(checkpoint, signals);
    const { trigger, reasons } = evaluateThresholds(metrics, thresholds, {
      force: Boolean(opts.force),
    });
    if (!trigger) return { distilled: false, reason: 'below-threshold', reasons };

    if (!apiKey) return { distilled: false, reason: 'no-api-key', reasons };
    const llmConfig = config.llm?.summarize || config.llm?.recall;
    if (!llmConfig) return { distilled: false, reason: 'no-llm-config', reasons };

    const projectId = projectIdFor(projectDir);
    const prompt = buildDistillPrompt(checkpoint, signals, reasons);

    let result = null;
    try {
      result = await llm(apiKey, llmConfig, prompt, {
        timeoutMs: 30000,
        title: 'Claude Code PreCompact Distillation',
      });
    } catch (err) {
      if (process.env.DEBUG) process.stderr.write('[distill] LLM failed: ' + err.message + '\n');
      return { distilled: false, reason: 'llm-error', reasons };
    }

    const proposals = parseProposals(result, projectId, reasons);
    if (proposals.length === 0) return { distilled: false, reason: 'no-proposals', reasons };

    let written = 0;
    for (const p of proposals) {
      if (appendMemory(projectDir, p).written) written += 1;
    }
    return { distilled: true, written, proposed: proposals.length, reasons };
  } catch (err) {
    if (process.env.DEBUG) process.stderr.write('[distill] error: ' + err.message + '\n');
    return { distilled: false, reason: 'error', reasons: [] };
  }
}
