import { describe, it, expect } from "vitest";
import { reduceEvents } from "../../../hooks/unified/modules/event-reducer.mjs";

const evt = (o: Record<string, unknown>) => ({
  id: "evt_x",
  sessionId: "s",
  ts: "2026-06-29T00:00:00.000Z",
  projectDir: "/repo",
  kind: "tool_call",
  outcome: "ok",
  files: [],
  symbols: [],
  ...o,
});

describe("reduceEvents (pure, deterministic)", () => {
  it("collects working/changed files and symbols", () => {
    const out = reduceEvents([
      evt({ kind: "read", files: ["src/a.ts"] }),
      evt({ kind: "edit", files: ["src/b.ts"], symbols: ["B.handle"] }),
      evt({ kind: "write", files: ["src/c.ts"] }),
    ]);
    expect(out.workingFiles).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(out.changedFiles).toEqual(["src/b.ts", "src/c.ts"]);
    expect(out.symbolsTouched).toEqual(["B.handle"]);
  });

  it("records tests, failures, and decisions", () => {
    const out = reduceEvents([
      evt({ kind: "test", summary: "vitest run" }),
      evt({
        kind: "error",
        outcome: "error",
        summary: "boom",
        files: ["x.ts"],
      }),
      evt({ kind: "decision", summary: "use sqlite" }),
    ]);
    expect(out.testsRun).toContain("vitest run");
    expect(out.failures).toContain("boom");
    expect(out.decisions).toContain("use sqlite");
  });

  it("computes open loops for unresolved file errors", () => {
    const unresolved = reduceEvents([
      evt({
        kind: "edit",
        outcome: "error",
        files: ["bug.ts"],
        summary: "type error",
      }),
    ]);
    expect(unresolved.openLoops.some((l: string) => l.includes("bug.ts"))).toBe(
      true,
    );
    expect(unresolved.nextActions.length).toBeGreaterThan(0);

    // A later clean edit on the same file resolves the loop.
    const resolved = reduceEvents([
      evt({
        kind: "edit",
        outcome: "error",
        files: ["bug.ts"],
        summary: "type error",
      }),
      evt({ kind: "edit", outcome: "ok", files: ["bug.ts"] }),
    ]);
    expect(resolved.openLoops).toHaveLength(0);
  });

  it("escalates risk on repeated failures and high-risk events", () => {
    expect(reduceEvents([evt({})]).risk).toBe("low");
    expect(
      reduceEvents([
        evt({ outcome: "error", summary: "1" }),
        evt({ outcome: "error", summary: "2" }),
        evt({ outcome: "error", summary: "3" }),
      ]).risk,
    ).toBe("high");
    expect(reduceEvents([evt({ risk: "critical" })]).risk).toBe("high");
    expect(reduceEvents([evt({ outcome: "error", summary: "1" })]).risk).toBe(
      "medium",
    );
  });

  it("counts permission denials and bumps medium risk", () => {
    const out = reduceEvents([
      evt({ kind: "permission", outcome: "denied", tool: "Bash" }),
      evt({ kind: "permission", outcome: "denied", tool: "Write" }),
    ]);
    expect(out.permissionDenials).toHaveLength(2);
    expect(out.risk).toBe("medium");
  });

  it("advances checkpointIndex from the previous checkpoint", () => {
    expect(reduceEvents([evt({})]).checkpointIndex).toBe(0);
    expect(
      reduceEvents([evt({})], { checkpointIndex: 4 }).checkpointIndex,
    ).toBe(5);
  });

  it("is deterministic — identical input reduces to identical output (replay)", () => {
    const events = [
      evt({ kind: "edit", files: ["a.ts"], symbols: ["f"] }),
      evt({ kind: "error", outcome: "error", summary: "x", files: ["a.ts"] }),
      evt({ kind: "test", summary: "t" }),
    ];
    const a = reduceEvents(events);
    const b = reduceEvents(events);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("tolerates garbage entries without throwing", () => {
    const out = reduceEvents([
      null,
      undefined,
      42,
      evt({ files: ["ok.ts"] }),
    ] as never[]);
    expect(out.workingFiles).toEqual(["ok.ts"]);
  });
});
