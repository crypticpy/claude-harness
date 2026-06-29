/**
 * PUNTAX config loader (hook runtime)
 *
 * Reads the `puntax` block from the already-loaded unified-hook config object
 * and applies PUNTAX_* environment-variable overrides. Pure and deterministic
 * so it can be unit-tested without touching the filesystem.
 *
 * A parallel TypeScript port lives at
 *   plugins/context-layer/src/config/puntax-config.ts
 * Keep the two in sync — they implement the same normalization semantics so the
 * hook runtime and the MCP server agree on flags/budgets.
 */

export const DEFAULT_PUNTAX = {
  contextRouter: {
    enabled: true,
    budgets: {
      prompt: 300,
      pre_edit: 1200,
      resume: 1500,
      debug: 2000,
      review: 3000,
      architecture: 3000,
    },
  },
  eventLedger: {
    enabled: false,
    path: '.claude/context-layer/events.jsonl',
    retentionDays: 90,
  },
  precompact: {
    mode: 'deterministic', // 'deterministic' | 'llm'
    llmFallback: 'failure_or_novelty',
    thresholds: {
      toolErrors: 3,
      retryPatterns: 2,
      explorationSpirals: 1,
      changedFiles: 6,
    },
  },
  llmDistillation: {
    enabled: false,
    model: 'gpt-5-mini',
    maxTokens: 4000,
  },
  codeMap: {
    enabled: false,
    dbPath: '.claude/context-layer/code-map.db',
    backendOrder: ['lsp', 'tree-sitter', 'regex'],
  },
  lsp: {
    enabled: false,
  },
};

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

/**
 * Parse an env var as a tri-state boolean. Returns `fallback` when unset or
 * unrecognized, so an empty/garbage env var never silently flips behavior.
 */
export function envFlag(env, name, fallback) {
  const raw = env?.[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  return fallback;
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merge `override` onto a deep clone of `base` (arrays replace wholesale). */
function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!isObject(override)) return out;
  for (const [key, value] of Object.entries(override)) {
    if (isObject(value) && isObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else if (Array.isArray(value)) {
      out[key] = [...value];
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Resolve effective PUNTAX settings.
 *
 * @param {object} config  The full unified-hook config object (may lack `puntax`).
 * @param {object} env     Environment map (defaults to process.env).
 * @returns {object} Normalized settings: defaults <- config.puntax <- env overrides.
 */
export function readPuntaxConfig(config = {}, env = process.env) {
  const raw = isObject(config) && isObject(config.puntax) ? config.puntax : {};
  // Clone defaults first: the env-override assignments below mutate `merged`,
  // and untouched nested subsystems would otherwise alias the shared default.
  const merged = deepMerge(structuredClone(DEFAULT_PUNTAX), raw);

  // Env overrides (highest precedence). Each only flips its own subsystem.
  merged.contextRouter.enabled = envFlag(env, 'PUNTAX_CONTEXT_ROUTER', merged.contextRouter.enabled);
  merged.eventLedger.enabled = envFlag(env, 'PUNTAX_EVENT_LEDGER', merged.eventLedger.enabled);
  merged.codeMap.enabled = envFlag(env, 'PUNTAX_CODE_MAP', merged.codeMap.enabled);
  merged.lsp.enabled = envFlag(env, 'PUNTAX_LSP', merged.lsp.enabled);
  merged.llmDistillation.enabled = envFlag(env, 'PUNTAX_LLM_DISTILLATION', merged.llmDistillation.enabled);

  const mode = env?.PUNTAX_PRECOMPACT_MODE;
  if (mode === 'deterministic' || mode === 'llm') {
    merged.precompact.mode = mode;
  }

  return merged;
}

export default readPuntaxConfig;
