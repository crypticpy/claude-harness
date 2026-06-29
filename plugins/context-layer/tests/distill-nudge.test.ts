import { describe, it, expect } from "vitest";

import { buildCompactionNudge } from "../../../hooks/unified/modules/distill-nudge.mjs";

describe("buildCompactionNudge", () => {
  it("returns '' when no deterministic substrate is available", () => {
    const collect = () => ({ available: false });
    expect(buildCompactionNudge("/repo", { collect } as any)).toBe("");
    expect(buildCompactionNudge(null, { collect } as any)).toBe("");
  });

  it("renders checkpoint facts + a memory_write instruction", () => {
    const collect = () => ({
      available: true,
      counts: { checkpoints: 2, memories: 3 },
      latestRisk: "high",
      openLoops: ["fix the build in a.ts"],
      failures: ["compile error in a.ts"],
      changedFiles: ["a.ts", "b.ts"],
      decisions: ["use forks pool"],
      memoryByKind: { gotcha: 2, test_command: 1 },
    });
    const out = buildCompactionNudge("/repo", { collect } as any);
    expect(out).toContain("Session distillation (post-compaction)");
    expect(out).toContain("memory_write");
    expect(out).toContain("Risk: high");
    expect(out).toContain("fix the build in a.ts");
    expect(out).toContain("Already stored: 3 typed memories");
    expect(out).toContain("gotcha:2");
    // explicitly tells the model not to re-add the deterministic facts
    expect(out).toContain("do NOT re-add");
  });

  it("skips the nudge when there is no signal and no checkpoints", () => {
    const collect = () => ({
      available: true,
      counts: { checkpoints: 0, memories: 0 },
      latestRisk: null,
      openLoops: [],
      failures: [],
      changedFiles: [],
      decisions: [],
      memoryByKind: {},
    });
    expect(buildCompactionNudge("/repo", { collect } as any)).toBe("");
  });
});
