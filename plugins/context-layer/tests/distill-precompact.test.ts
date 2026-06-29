import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  evaluateThresholds,
  buildMetrics,
} from "../../../hooks/unified/modules/distill-threshold.mjs";
import {
  parseProposals,
  runDistill,
} from "../../../hooks/unified/modules/distill-precompact.mjs";
import { readMemories } from "../../../hooks/unified/modules/memory-store.mjs";

const THRESHOLDS = {
  toolErrors: 3,
  retryPatterns: 2,
  explorationSpirals: 1,
  changedFiles: 6,
};

describe("evaluateThresholds", () => {
  it("does not trigger on a quiet session", () => {
    const r = evaluateThresholds(
      {
        toolErrors: 0,
        retryPatterns: 0,
        explorationSpirals: 0,
        changedFiles: 1,
      },
      THRESHOLDS,
    );
    expect(r.trigger).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it("triggers on each individual threshold", () => {
    expect(evaluateThresholds({ toolErrors: 3 }, THRESHOLDS).trigger).toBe(
      true,
    );
    expect(evaluateThresholds({ retryPatterns: 2 }, THRESHOLDS).trigger).toBe(
      true,
    );
    expect(
      evaluateThresholds({ explorationSpirals: 1 }, THRESHOLDS).trigger,
    ).toBe(true);
    expect(evaluateThresholds({ changedFiles: 6 }, THRESHOLDS).trigger).toBe(
      true,
    );
    expect(
      evaluateThresholds({ permissionDenials: 2 }, THRESHOLDS).reasons,
    ).toContain("repeated-permission-denial");
    expect(
      evaluateThresholds({ highRisk: true }, THRESHOLDS).reasons,
    ).toContain("high-severity-error");
  });

  it("force triggers with an explicit-request reason", () => {
    const r = evaluateThresholds({}, THRESHOLDS, { force: true });
    expect(r.trigger).toBe(true);
    expect(r.reasons).toContain("explicit-request");
  });
});

describe("buildMetrics", () => {
  it("merges checkpoint counts with transcript signals", () => {
    const m = buildMetrics(
      {
        changedFiles: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"],
        permissionDenials: ["x", "y"],
        risk: "high",
      },
      { toolErrors: 4, retryPatterns: 1, explorationSpirals: 0 },
    );
    expect(m.changedFiles).toBe(6);
    expect(m.permissionDenials).toBe(2);
    expect(m.highRisk).toBe(true);
    expect(m.toolErrors).toBe(4);
  });
});

describe("parseProposals", () => {
  it("keeps valid proposals and tags them llm_distilled / source llm", () => {
    const out = parseProposals(
      {
        memories: [
          {
            kind: "gotcha",
            scope: "file",
            text: "preserve CRLF on write",
            severity: "high",
          },
          { kind: "decision", text: "use vitest forks pool" }, // scope/severity defaulted
        ],
      },
      "prj_x",
      ["changedFiles>=6"],
    );
    expect(out).toHaveLength(2);
    expect(out[0].confidence).toBe("llm_distilled");
    expect(out[0].provenance.source).toBe("llm");
    expect(out[1].scope).toBe("project");
    expect(out[1].severity).toBe("medium");
  });

  it("drops malformed proposals (bad kind, empty text, too long)", () => {
    const out = parseProposals(
      {
        memories: [
          { kind: "not_a_kind", text: "x" },
          { kind: "gotcha", text: "" },
          { kind: "gotcha", text: "a".repeat(4001) },
          "garbage",
        ],
      },
      "prj_x",
      [],
    );
    expect(out).toEqual([]);
  });

  it("handles a bare array and non-object input", () => {
    expect(
      parseProposals([{ kind: "gotcha", text: "ok" }], "prj_x", []).length,
    ).toBe(1);
    expect(parseProposals(null, "prj_x", [])).toEqual([]);
  });
});

describe("runDistill — gated end-to-end against a mocked LLM", () => {
  let dir: string;
  let transcript: string;
  const signals = {
    totalToolCalls: 30,
    toolErrors: 4,
    retryPatterns: 0,
    explorationSpirals: 0,
    permissionDenials: 0,
    errorMessages: ["boom"],
  };
  const parseTranscript = () => ({ signals, condensed: "" });
  const config = { llm: { summarize: { model: "mock", maxTokens: 100 } } };
  const checkpoint = { changedFiles: [], failures: [], workingFiles: ["a.ts"] };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "distill-"));
    transcript = path.join(dir, "t.jsonl");
    fs.writeFileSync(transcript, "{}\n");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const event = () => ({ session_id: "s1", transcript_path: transcript });

  it("writes typed memories when a threshold trips (toolErrors>=3)", async () => {
    const callLlm = async () => ({
      memories: [
        {
          kind: "failure_pattern",
          scope: "project",
          text: "tool errors cluster around X",
          severity: "high",
        },
      ],
    });
    const res = await runDistill(event(), config, "api-key", {
      checkpoint,
      projectDir: dir,
      thresholds: THRESHOLDS,
      deps: { parseTranscript, callLlm },
    });
    expect(res.distilled).toBe(true);
    expect(res.written).toBe(1);
    const mems = readMemories(dir);
    expect(mems).toHaveLength(1);
    expect(mems[0].confidence).toBe("llm_distilled");
    expect(mems[0].provenance.source).toBe("llm");
  });

  it("is a no-op with no API key (graceful)", async () => {
    let called = false;
    const callLlm = async () => {
      called = true;
      return { memories: [] };
    };
    const res = await runDistill(event(), config, null, {
      checkpoint,
      projectDir: dir,
      thresholds: THRESHOLDS,
      deps: { parseTranscript, callLlm },
    });
    expect(res.distilled).toBe(false);
    expect(res.reason).toBe("no-api-key");
    expect(called).toBe(false);
    expect(readMemories(dir)).toHaveLength(0);
  });

  it("does not distill below threshold", async () => {
    const quiet = () => ({
      signals: { ...signals, toolErrors: 0 },
      condensed: "",
    });
    const callLlm = async () => ({ memories: [{ kind: "gotcha", text: "x" }] });
    const res = await runDistill(event(), config, "api-key", {
      checkpoint,
      projectDir: dir,
      thresholds: THRESHOLDS,
      deps: { parseTranscript: quiet, callLlm },
    });
    expect(res.distilled).toBe(false);
    expect(res.reason).toBe("below-threshold");
    expect(readMemories(dir)).toHaveLength(0);
  });

  it("discards invalid LLM output without writing", async () => {
    const callLlm = async () => ({ memories: [{ kind: "bogus", text: "x" }] });
    const res = await runDistill(event(), config, "api-key", {
      checkpoint,
      projectDir: dir,
      thresholds: THRESHOLDS,
      deps: { parseTranscript, callLlm },
    });
    expect(res.distilled).toBe(false);
    expect(res.reason).toBe("no-proposals");
    expect(readMemories(dir)).toHaveLength(0);
  });
});
