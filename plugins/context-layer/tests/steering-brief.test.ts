import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  shouldGenerate,
  digestEvents,
  buildBriefPrompt,
  generateBrief,
  maybeScheduleBrief,
  buildBriefInjection,
  readBrief,
} from "../../../hooks/unified/modules/steering-brief.mjs";

let tmp: string;

function contextDir(): string {
  return path.join(tmp, ".claude", "context-layer");
}

function writeCheckpoints(sessionId: string, n: number) {
  fs.mkdirSync(contextDir(), { recursive: true });
  const rows = Array.from({ length: n }, (_, i) =>
    JSON.stringify({ type: "checkpoint", session_id: sessionId, seq: i }),
  );
  fs.writeFileSync(path.join(contextDir(), "checkpoints.jsonl"), rows.join("\n") + "\n");
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brief-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("shouldGenerate", () => {
  it("fires only on exact multiples of N", () => {
    expect(shouldGenerate(5, 5)).toBe(true);
    expect(shouldGenerate(10, 5)).toBe(true);
    expect(shouldGenerate(4, 5)).toBe(false);
    expect(shouldGenerate(0, 5)).toBe(false);
    expect(shouldGenerate(5, 0)).toBe(false);
    expect(shouldGenerate(NaN, 5)).toBe(false);
  });
});

describe("digestEvents", () => {
  it("summarizes kinds, files, and errors; handles empty", () => {
    expect(digestEvents([])).toContain("no ledger events");
    const digest = digestEvents([
      { kind: "test", outcome: "ok", files: ["a.ts"] },
      { kind: "test", outcome: "error", command: "npm test -- --run foo" },
      { kind: "edit", outcome: "ok", files: ["a.ts", "b.ts"] },
    ]);
    expect(digest).toContain("test:2");
    expect(digest).toContain("edit:1");
    expect(digest).toContain("a.ts (2)");
    expect(digest).toContain("npm test -- --run foo");
  });
});

describe("buildBriefPrompt", () => {
  it("carries charter, previous brief, and replace-not-append semantics", () => {
    const prompt = buildBriefPrompt({
      count: 10,
      everyN: 5,
      charter: { mission: "Ship the widget", scope: ["src/"], constraints: ["no api changes"] },
      manifest: { items: [{ file: "src/a.ts", symbol: "foo", note: "rename", status: "pending" }] },
      prevBrief: "**Open threads**\n- old thread",
      facts: "Risk: medium",
      eventsDigest: "Events by kind: edit:3",
    });
    expect(prompt).toContain("Ship the widget");
    expect(prompt).toContain("old thread");
    expect(prompt).toContain("REPLACES the previous one");
    expect(prompt).toContain("src/a.ts — foo (rename)");
    expect(prompt).toContain("Risk: medium");
    expect(prompt).toContain("at most 30 lines");
  });
});

describe("maybeScheduleBrief", () => {
  it("spawns the detached worker only on the Nth compaction", () => {
    const calls: any[] = [];
    const spawn = (...args: any[]) => {
      calls.push(args);
      return { unref: () => {} };
    };
    const config = { puntax: { steeringBrief: { everyNCompactions: 5 } } };

    writeCheckpoints("s1", 4);
    expect(
      maybeScheduleBrief({ session_id: "s1" }, config, { projectDir: tmp, spawn }),
    ).toMatchObject({ scheduled: false, count: 4 });

    writeCheckpoints("s1", 5);
    const r = maybeScheduleBrief({ session_id: "s1" }, config, { projectDir: tmp, spawn });
    expect(r).toMatchObject({ scheduled: true, count: 5 });
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toContain("--worker");
    expect(calls[0][2]).toMatchObject({ detached: true });
  });

  it("respects enabled:false and other sessions' checkpoints", () => {
    const spawn = () => ({ unref: () => {} });
    writeCheckpoints("other-session", 5);
    expect(
      maybeScheduleBrief({ session_id: "s1" }, {}, { projectDir: tmp, spawn }),
    ).toMatchObject({ scheduled: false });
    expect(
      maybeScheduleBrief(
        { session_id: "other-session" },
        { puntax: { steeringBrief: { enabled: false } } },
        { projectDir: tmp, spawn },
      ),
    ).toMatchObject({ scheduled: false, reason: "disabled" });
  });
});

describe("generateBrief + buildBriefInjection", () => {
  it("overwrites the brief and injects it per source rules", async () => {
    fs.mkdirSync(contextDir(), { recursive: true });

    // First generation.
    let r = await generateBrief(tmp, "s1", 5, {
      config: {},
      deps: { callLlm: async () => "**Mission status**\nOn course; next: wire tests." },
    });
    expect(r.written).toBe(true);
    expect(readBrief(tmp)?.brief).toContain("On course");

    // Second generation REPLACES (not appends) and its prompt sees the previous brief.
    let seenPrompt = "";
    r = await generateBrief(tmp, "s1", 10, {
      config: {},
      deps: {
        callLlm: async (_k: any, _c: any, prompt: string) => {
          seenPrompt = prompt;
          return "**Mission status**\nDone.";
        },
      },
    });
    expect(seenPrompt).toContain("On course"); // prev brief fed into the new prompt
    const b = readBrief(tmp);
    expect(b?.brief).toBe("**Mission status**\nDone.");
    expect(b?.brief).not.toContain("On course"); // replaced, not accumulated
    expect(b?.compactions).toBe(10);

    // Injection: compact + same session → yes; resume fresh → yes;
    // resume stale (>48h) → no; startup → no.
    expect(buildBriefInjection(tmp, { source: "compact", session_id: "s1" })).toContain("Done.");
    expect(buildBriefInjection(tmp, { source: "resume", session_id: "s2" })).toContain("Done.");
    const stale = Date.parse(b!.generatedAt) + 49 * 3_600_000;
    expect(
      buildBriefInjection(tmp, { source: "resume", session_id: "s2" }, { now: stale }),
    ).toBeNull();
    expect(buildBriefInjection(tmp, { source: "startup", session_id: "s1" })).toBeNull();
  });

  it("does not write when the LLM fails", async () => {
    const r = await generateBrief(tmp, "s1", 5, {
      config: {},
      deps: { callLlm: async () => null },
    });
    expect(r).toMatchObject({ written: false, reason: "llm-null" });
    expect(readBrief(tmp)).toBeNull();
  });
});
