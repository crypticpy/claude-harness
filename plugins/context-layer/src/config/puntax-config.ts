/**
 * PUNTAX config loader (MCP-server runtime)
 *
 * TypeScript port of hooks/unified/modules/puntax-config.mjs. Keep the two in
 * sync: identical normalization so the hook runtime and the MCP server agree on
 * flags/budgets. The MCP server is a separate process from the hooks, so it
 * locates the harness config.json on disk (or accepts an explicit path/object).
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type PrecompactMode = "deterministic" | "llm";

export interface PuntaxConfig {
  contextRouter: {
    enabled: boolean;
    budgets: {
      prompt: number;
      pre_edit: number;
      resume: number;
      debug: number;
      review: number;
      architecture: number;
    };
  };
  eventLedger: {
    enabled: boolean;
    path: string;
    retentionDays: number;
  };
  precompact: {
    mode: PrecompactMode;
    llmFallback: string;
    thresholds: {
      toolErrors: number;
      retryPatterns: number;
      explorationSpirals: number;
      changedFiles: number;
    };
  };
  llmDistillation: {
    enabled: boolean;
    model: string;
    maxTokens: number;
  };
  codeMap: {
    enabled: boolean;
    dbPath: string;
    backendOrder: string[];
  };
}

export type RouterMode = keyof PuntaxConfig["contextRouter"]["budgets"];

export const DEFAULT_PUNTAX: PuntaxConfig = {
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
    path: ".claude/context-layer/events.jsonl",
    retentionDays: 90,
  },
  precompact: {
    mode: "llm",
    llmFallback: "failure_or_novelty",
    thresholds: {
      toolErrors: 3,
      retryPatterns: 2,
      explorationSpirals: 1,
      changedFiles: 6,
    },
  },
  llmDistillation: {
    enabled: false,
    model: "gpt-5-mini",
    maxTokens: 4000,
  },
  codeMap: {
    enabled: false,
    dbPath: ".claude/context-layer/code-map.db",
    backendOrder: ["lsp", "tree-sitter", "regex"],
  },
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

type EnvMap = Record<string, string | undefined>;

/** Tri-state boolean env parse; returns `fallback` when unset/unrecognized. */
export function envFlag(env: EnvMap, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const v = String(raw).trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  return fallback;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge<T>(base: T, override: unknown): T {
  if (Array.isArray(base)) {
    return (Array.isArray(override)
      ? [...override]
      : [...base]) as unknown as T;
  }
  if (!isObject(base)) {
    return override === undefined ? base : (override as T);
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  if (isObject(override)) {
    for (const [key, value] of Object.entries(override)) {
      if (isObject(value) && isObject(out[key])) {
        out[key] = deepMerge(out[key], value);
      } else if (Array.isArray(value)) {
        out[key] = [...value];
      } else if (value !== undefined) {
        out[key] = value;
      }
    }
  }
  return out as T;
}

/**
 * Normalize PUNTAX settings: defaults <- config.puntax <- env overrides.
 * `config` is the full unified-hook config object (may lack a `puntax` key).
 */
export function readPuntaxConfig(
  config: unknown = {},
  env: EnvMap = process.env,
): PuntaxConfig {
  const raw = isObject(config) && isObject(config.puntax) ? config.puntax : {};
  // Clone defaults first: the env-override assignments below mutate `merged`,
  // and untouched nested subsystems would otherwise alias the shared default.
  const merged = deepMerge(structuredClone(DEFAULT_PUNTAX), raw);

  merged.contextRouter.enabled = envFlag(
    env,
    "PUNTAX_CONTEXT_ROUTER",
    merged.contextRouter.enabled,
  );
  merged.eventLedger.enabled = envFlag(
    env,
    "PUNTAX_EVENT_LEDGER",
    merged.eventLedger.enabled,
  );
  merged.codeMap.enabled = envFlag(
    env,
    "PUNTAX_CODE_MAP",
    merged.codeMap.enabled,
  );
  merged.llmDistillation.enabled = envFlag(
    env,
    "PUNTAX_LLM_DISTILLATION",
    merged.llmDistillation.enabled,
  );

  const mode = env.PUNTAX_PRECOMPACT_MODE;
  if (mode === "deterministic" || mode === "llm") {
    merged.precompact.mode = mode;
  }

  return merged;
}

/**
 * Candidate locations for the harness config.json, in priority order.
 * The MCP server runs from the installed plugin dir, so it cannot rely on a
 * fixed relative path to the hooks config.
 */
export function configCandidatePaths(
  env: EnvMap = process.env,
  home: string = os.homedir(),
): string[] {
  const candidates: string[] = [];
  if (env.PUNTAX_CONFIG_PATH) candidates.push(env.PUNTAX_CONFIG_PATH);
  candidates.push(
    path.join(home, ".claude", "hooks", "unified", "config.json"),
  );
  return candidates;
}

/**
 * Load and normalize PUNTAX config from disk. Reads the first readable candidate
 * config.json; falls back to DEFAULT_PUNTAX (with env overrides) if none parse.
 * Never throws — config loading must not break the MCP server.
 */
export function loadPuntaxConfig(
  opts: { env?: EnvMap; home?: string; explicitPath?: string } = {},
): PuntaxConfig {
  const env = opts.env ?? process.env;
  const home = opts.home ?? os.homedir();
  const paths = opts.explicitPath
    ? [opts.explicitPath]
    : configCandidatePaths(env, home);

  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
        return readPuntaxConfig(parsed, env);
      }
    } catch {
      // Corrupt/unreadable candidate — try the next one.
    }
  }
  return readPuntaxConfig({}, env);
}
