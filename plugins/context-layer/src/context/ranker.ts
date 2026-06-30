/**
 * Context Ranker (pure)
 *
 * Deterministic, side-effect-free ranking + budget packing for puntax_context.
 * Implements the docs/08 pseudo-ranking:
 *
 *   score = fileMatch*5 + symbolMatch*5 + severityWeight + confidenceWeight
 *         + recencyWeight + hotFileWeight + keywordScore - tokenCostPenalty
 *
 * Kept free of I/O and of Date.now()/Math.random() so it is trivially testable
 * and so callers control the "now" used for recency decay.
 */

export type SourceKind =
  "memory" | "event" | "file" | "symbol" | "permission" | "checkpoint";

export type Severity = "low" | "medium" | "high";
export type Confidence = "low" | "medium" | "high";

export interface RankCandidate {
  kind: SourceKind;
  id?: string;
  path?: string;
  line?: number;
  /** Renderable content; also used to estimate token cost. */
  text: string;
  /** Explicit file match against the caller's `files` input. */
  fileMatch?: boolean;
  /** Explicit symbol match against the caller's `symbols` input. */
  symbolMatch?: boolean;
  severity?: Severity | string;
  confidence?: Confidence | string;
  /** ISO timestamp or epoch ms; older items earn less recency weight. */
  timestamp?: string | number;
  /** Normalized hot-file score (caller-normalized; clamped to [0,3] here). */
  hotFileScore?: number;
  /** Keyword-overlap score from a brain_search-style scan. */
  keywordScore?: number;
}

export interface RankedItem extends RankCandidate {
  score: number;
  tokens: number;
}

export interface RankOptions {
  budgetTokens: number;
  /** Reference "now" (epoch ms) for recency decay. Pass explicitly to stay pure. */
  now?: number;
  /** Recency half-life in ms (default 7 days). */
  recencyHalfLifeMs?: number;
  /** Hard cap on selected items regardless of remaining budget. */
  maxItems?: number;
}

export interface RankResult {
  selected: RankedItem[];
  omitted: number;
  usedTokens: number;
}

const DEFAULT_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** Rough token estimate: ~4 chars/token, floor of 1. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text?.length ?? 0) / 4));
}

function severityWeight(severity?: string): number {
  switch ((severity || "").toLowerCase()) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 1.5;
    case "low":
      return 0.5;
    default:
      return 0;
  }
}

function confidenceWeight(confidence?: string): number {
  switch ((confidence || "").toLowerCase()) {
    case "high":
      return 2;
    case "medium":
      return 1;
    case "low":
      return 0.5;
    default:
      return 0.5;
  }
}

function toEpochMs(timestamp?: string | number): number | null {
  if (timestamp == null) return null;
  if (typeof timestamp === "number")
    return Number.isFinite(timestamp) ? timestamp : null;
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
}

function recencyWeight(
  timestamp: string | number | undefined,
  now: number | undefined,
  halfLifeMs: number,
): number {
  const ts = toEpochMs(timestamp);
  if (ts == null || now == null) return 0;
  const ageMs = Math.max(0, now - ts);
  const decay = Math.pow(0.5, ageMs / halfLifeMs); // 1 at age 0, 0.5 at one half-life
  return 2 * decay;
}

/** Compute the ranking score for a single candidate. Pure. */
export function scoreCandidate(
  candidate: RankCandidate,
  opts: Pick<RankOptions, "now" | "recencyHalfLifeMs"> = {},
): number {
  const tokens = estimateTokens(candidate.text);
  const halfLife = opts.recencyHalfLifeMs ?? DEFAULT_HALF_LIFE_MS;

  const fileMatch = candidate.fileMatch ? 5 : 0;
  const symbolMatch = candidate.symbolMatch ? 5 : 0;
  const sev = severityWeight(candidate.severity);
  const conf = confidenceWeight(candidate.confidence);
  const recency = recencyWeight(candidate.timestamp, opts.now, halfLife);
  const hot = Math.min(Math.max(candidate.hotFileScore ?? 0, 0), 3);
  const keyword = candidate.keywordScore ?? 0;
  const tokenPenalty = tokens / 400;

  return (
    fileMatch +
    symbolMatch +
    sev +
    conf +
    recency +
    hot +
    keyword -
    tokenPenalty
  );
}

/**
 * Rank candidates by score, then greedily pack them under `budgetTokens`.
 * Greedy-by-score with token packing: higher-scoring items win, but a
 * lower-scoring item that still fits is taken once a larger one is skipped.
 */
export function rankCandidates(
  candidates: RankCandidate[],
  opts: RankOptions,
): RankResult {
  const budget = Math.max(0, opts.budgetTokens || 0);
  const maxItems = opts.maxItems ?? Infinity;

  const scored: RankedItem[] = candidates.map((c) => ({
    ...c,
    tokens: estimateTokens(c.text),
    score: scoreCandidate(c, opts),
  }));

  // Sort by score desc; tie-break by smaller token cost, then more recent.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.tokens !== b.tokens) return a.tokens - b.tokens;
    const at = toEpochMs(a.timestamp) ?? 0;
    const bt = toEpochMs(b.timestamp) ?? 0;
    return bt - at;
  });

  const selected: RankedItem[] = [];
  let usedTokens = 0;
  for (const item of scored) {
    if (selected.length >= maxItems) break;
    if (usedTokens + item.tokens <= budget) {
      selected.push(item);
      usedTokens += item.tokens;
    }
  }

  return {
    selected,
    omitted: scored.length - selected.length,
    usedTokens,
  };
}
