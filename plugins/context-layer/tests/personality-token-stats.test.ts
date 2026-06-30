import { describe, it, expect } from "vitest";
import { isTokenStatsFresh } from "../src/hooks/personality-hook";

// The token-stats file (/tmp/claude-context-stats.json) is global and shared
// across sessions. isTokenStatsFresh is the guard that stops a new session's
// first personality injection from reporting the PREVIOUS session's token
// count (the "238K/256K (93%)" stale-read bug).

const NOW = 1_782_800_000_000; // fixed clock (ms)
const nowSec = Math.floor(NOW / 1000);

describe("isTokenStatsFresh", () => {
  it("accepts a snapshot whose session_id matches the current session", () => {
    const stats = { timestamp: nowSec - 3600, session_id: "sess-A" }; // even if old
    expect(isTokenStatsFresh(stats, "sess-A", NOW)).toBe(true);
  });

  it("rejects a snapshot from a different session (the stale-read bug)", () => {
    const stats = { timestamp: nowSec - 1, session_id: "sess-OLD" };
    expect(isTokenStatsFresh(stats, "sess-NEW", NOW)).toBe(false);
  });

  it("accepts a fresh legacy snapshot with no session_id", () => {
    const stats = { timestamp: nowSec - 30 }; // 30s ago
    expect(isTokenStatsFresh(stats, "sess-NEW", NOW)).toBe(true);
  });

  it("rejects a stale legacy snapshot with no session_id", () => {
    const stats = { timestamp: nowSec - 600 }; // 10 min ago
    expect(isTokenStatsFresh(stats, "sess-NEW", NOW)).toBe(false);
  });

  it("treats the timestamp as seconds, not milliseconds", () => {
    // If the guard wrongly compared against ms, a seconds timestamp would look
    // ~50 years stale and always be rejected. 60s ago must pass.
    const stats = { timestamp: nowSec - 60 };
    expect(isTokenStatsFresh(stats, undefined, NOW)).toBe(true);
  });

  it("falls back to freshness when only the snapshot carries a session_id", () => {
    const fresh = { timestamp: nowSec - 10, session_id: "sess-X" };
    const stale = { timestamp: nowSec - 600, session_id: "sess-X" };
    expect(isTokenStatsFresh(fresh, undefined, NOW)).toBe(true);
    expect(isTokenStatsFresh(stale, undefined, NOW)).toBe(false);
  });

  it("rejects a snapshot with a missing/non-numeric timestamp and no session match", () => {
    expect(
      isTokenStatsFresh(
        { timestamp: undefined as unknown as number },
        "s",
        NOW,
      ),
    ).toBe(false);
  });
});
