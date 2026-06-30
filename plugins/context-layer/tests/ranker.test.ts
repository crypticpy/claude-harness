import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  scoreCandidate,
  rankCandidates,
  type RankCandidate,
} from "../src/context/ranker";

const NOW = 1_700_000_000_000; // fixed reference for deterministic recency

function cand(overrides: Partial<RankCandidate>): RankCandidate {
  return { kind: "memory", text: "x", ...overrides };
}

describe("estimateTokens", () => {
  it("estimates ~4 chars per token with a floor of 1", () => {
    expect(estimateTokens("")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("scoreCandidate", () => {
  it("boosts explicit file and symbol matches by 5 each", () => {
    const base = scoreCandidate(cand({ text: "hello" }), { now: NOW });
    const withFile = scoreCandidate(cand({ text: "hello", fileMatch: true }), {
      now: NOW,
    });
    const withSymbol = scoreCandidate(
      cand({ text: "hello", symbolMatch: true }),
      { now: NOW },
    );
    expect(withFile - base).toBeCloseTo(5, 5);
    expect(withSymbol - base).toBeCloseTo(5, 5);
  });

  it("weights severity high > medium > low", () => {
    const high = scoreCandidate(cand({ severity: "high" }), { now: NOW });
    const med = scoreCandidate(cand({ severity: "medium" }), { now: NOW });
    const low = scoreCandidate(cand({ severity: "low" }), { now: NOW });
    expect(high).toBeGreaterThan(med);
    expect(med).toBeGreaterThan(low);
  });

  it("decays recency: newer scores higher than older", () => {
    const newer = scoreCandidate(cand({ timestamp: NOW }), { now: NOW });
    const week = scoreCandidate(
      cand({ timestamp: NOW - 7 * 24 * 60 * 60 * 1000 }),
      { now: NOW },
    );
    const ancient = scoreCandidate(cand({ timestamp: NOW - 1e12 }), {
      now: NOW,
    });
    expect(newer).toBeGreaterThan(week);
    expect(week).toBeGreaterThan(ancient);
  });

  it("penalizes larger items via token cost", () => {
    const small = scoreCandidate(cand({ text: "short" }), { now: NOW });
    const large = scoreCandidate(cand({ text: "a".repeat(4000) }), {
      now: NOW,
    });
    expect(small).toBeGreaterThan(large);
  });

  it("applies kindWeight as a direct additive bias (boost and penalty)", () => {
    const base = scoreCandidate(cand({ text: "hello" }), { now: NOW });
    const boosted = scoreCandidate(
      cand({ text: "hello", kindWeight: 2 }),
      { now: NOW },
    );
    const penalized = scoreCandidate(
      cand({ text: "hello", kindWeight: -0.5 }),
      { now: NOW },
    );
    expect(boosted - base).toBeCloseTo(2);
    expect(penalized - base).toBeCloseTo(-0.5);
    // A boosted decision outranks a penalized test_command of equal text.
    expect(boosted).toBeGreaterThan(penalized);
  });

  it("is pure — no now means zero recency contribution, no throw", () => {
    expect(() => scoreCandidate(cand({ timestamp: NOW }))).not.toThrow();
    const noNow = scoreCandidate(cand({ timestamp: NOW }));
    const noTs = scoreCandidate(cand({}));
    expect(noNow).toBeCloseTo(noTs, 5);
  });
});

describe("rankCandidates", () => {
  it("packs selections under the token budget and counts omitted", () => {
    const items: RankCandidate[] = [
      cand({ id: "a", text: "a".repeat(400), keywordScore: 5 }), // 100 tokens
      cand({ id: "b", text: "b".repeat(400), keywordScore: 4 }), // 100 tokens
      cand({ id: "c", text: "c".repeat(400), keywordScore: 3 }), // 100 tokens
    ];
    const result = rankCandidates(items, { budgetTokens: 250, now: NOW });
    expect(result.usedTokens).toBeLessThanOrEqual(250);
    expect(result.selected.length).toBe(2);
    expect(result.omitted).toBe(1);
    // Highest keywordScore wins.
    expect(result.selected[0].id).toBe("a");
  });

  it("respects maxItems regardless of budget", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      cand({ id: String(i), text: "tiny", keywordScore: 10 - i }),
    );
    const result = rankCandidates(items, {
      budgetTokens: 100000,
      now: NOW,
      maxItems: 3,
    });
    expect(result.selected.length).toBe(3);
    expect(result.omitted).toBe(7);
  });

  it("orders by score descending", () => {
    const items: RankCandidate[] = [
      cand({ id: "low", text: "x", keywordScore: 1 }),
      cand({ id: "high", text: "x", fileMatch: true, keywordScore: 1 }),
      cand({ id: "mid", text: "x", severity: "high" }),
    ];
    const result = rankCandidates(items, { budgetTokens: 1000, now: NOW });
    expect(result.selected[0].id).toBe("high");
  });

  it("skips an item larger than the whole budget but keeps smaller ones", () => {
    const items: RankCandidate[] = [
      cand({ id: "huge", text: "h".repeat(8000), keywordScore: 100 }), // 2000 tokens
      cand({ id: "small", text: "small", keywordScore: 1 }),
    ];
    const result = rankCandidates(items, { budgetTokens: 300, now: NOW });
    expect(result.selected.map((s) => s.id)).toEqual(["small"]);
    expect(result.omitted).toBe(1);
  });

  it("returns empty selection for a zero budget", () => {
    const result = rankCandidates([cand({ text: "x" })], {
      budgetTokens: 0,
      now: NOW,
    });
    expect(result.selected).toHaveLength(0);
    expect(result.omitted).toBe(1);
  });
});
