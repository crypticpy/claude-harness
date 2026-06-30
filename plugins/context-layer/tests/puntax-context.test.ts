import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { puntaxContext } from "../src/tools/puntax-context";
import { DEFAULT_PUNTAX, type PuntaxConfig } from "../src/config/puntax-config";

const NOW = 1_700_000_000_000;
let projectDir: string;
let brainDir: string;

function config(overrides: Partial<PuntaxConfig> = {}): PuntaxConfig {
  return { ...structuredClone(DEFAULT_PUNTAX), ...overrides };
}

function writeBrain(file: string, content: string): void {
  fs.writeFileSync(path.join(brainDir, file), content);
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-ctx-"));
  brainDir = path.join(projectDir, ".claude", "context-layer");
  fs.mkdirSync(brainDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("puntaxContext", () => {
  it("returns relevant high-severity memory and ranks it first", async () => {
    writeBrain(
      "lessons.jsonl",
      [
        JSON.stringify({
          timestamp: new Date(NOW).toISOString(),
          type: "mistake",
          lesson: "authentication tokens must be refreshed before expiry",
          severity: "high",
        }),
        JSON.stringify({
          timestamp: new Date(NOW).toISOString(),
          type: "discovery",
          lesson: "the build script lives in scripts/build.sh",
          severity: "low",
        }),
      ].join("\n"),
    );

    const out = await puntaxContext(
      { task: "fix authentication token refresh", projectDir, mode: "debug" },
      { config: config(), now: NOW },
    );

    expect(out.context).toContain("authentication tokens");
    expect(out.sources.length).toBeGreaterThan(0);
    expect(out.sources[0].kind).toBe("memory");
    // first line should be the high-severity authentication lesson
    expect(out.context.split("\n")[0]).toContain("authentication");
  });

  it("raises confidence to high on an explicit file match", async () => {
    writeBrain(
      "file-insights.json",
      JSON.stringify({
        insights: {
          "src/auth/login.ts": {
            role: "auth entry point",
            risk: "high",
            notes: ["handles session creation"],
          },
        },
      }),
    );

    const out = await puntaxContext(
      {
        task: "edit login",
        projectDir,
        mode: "pre_edit",
        files: ["src/auth/login.ts"],
      },
      { config: config(), now: NOW },
    );

    expect(out.confidence).toBe("high");
    expect(out.sources[0].path).toBe("src/auth/login.ts");
  });

  it("respects the token budget and reports omitted items", async () => {
    // 30 chunky lessons, tiny budget → only a few fit.
    const lines = Array.from({ length: 30 }, (_, i) =>
      JSON.stringify({
        timestamp: new Date(NOW).toISOString(),
        type: "discovery",
        lesson: `lesson ${i} about parsing ` + "x".repeat(200),
        severity: "medium",
      }),
    );
    writeBrain("lessons.jsonl", lines.join("\n"));

    const out = await puntaxContext(
      { task: "parsing", projectDir, mode: "prompt", budgetTokens: 120 },
      { config: config(), now: NOW },
    );

    const tokens = Math.ceil(out.context.length / 4);
    expect(tokens).toBeLessThanOrEqual(140); // budget + small slack
    expect(out.omitted?.count).toBeGreaterThan(0);
  });

  it("no-ops when the router is disabled (rollback)", async () => {
    writeBrain(
      "lessons.jsonl",
      JSON.stringify({ type: "x", lesson: "anything", severity: "high" }),
    );
    const disabled = config();
    disabled.contextRouter.enabled = false;

    const out = await puntaxContext(
      { task: "anything", projectDir },
      { config: disabled, now: NOW },
    );

    expect(out.context).toBe("");
    expect(out.sources).toHaveLength(0);
    expect(out.omitted?.reason).toMatch(/disabled/);
  });

  it("degrades gracefully on missing and corrupt brain files", async () => {
    // file-insights is corrupt; lessons has one bad line and one good line.
    writeBrain("file-insights.json", "{ not valid json");
    writeBrain(
      "lessons.jsonl",
      [
        "{bad",
        JSON.stringify({
          type: "x",
          lesson: "good parsing lesson",
          severity: "medium",
        }),
      ].join("\n"),
    );

    const out = await puntaxContext(
      { task: "parsing", projectDir, mode: "prompt" },
      { config: config(), now: NOW },
    );

    expect(out.context).toContain("good parsing lesson");
  });

  it("returns low confidence and empty context for an empty project", async () => {
    const out = await puntaxContext(
      { task: "whatever", projectDir, mode: "prompt" },
      { config: config(), now: NOW },
    );
    expect(out.context).toBe("");
    expect(out.confidence).toBe("low");
    expect(out.nextTools.length).toBeGreaterThan(0);
  });

  it("surfaces an active typed memory (memories.jsonl) matching the task", async () => {
    writeBrain(
      "memories.jsonl",
      JSON.stringify({
        id: "mem_a",
        kind: "gotcha",
        scope: "project",
        text: "the ranker tie-break must stay deterministic across runs",
        severity: "high",
        createdAt: new Date(NOW).toISOString(),
        status: "active",
      }),
    );

    const out = await puntaxContext(
      { task: "improve ranker tie-break", projectDir, mode: "debug" },
      { config: config(), now: NOW },
    );

    expect(out.context).toContain("ranker tie-break must stay deterministic");
    expect(out.sources.some((s) => s.kind === "memory")).toBe(true);
  });

  it("excludes archived and expired typed memories from recall", async () => {
    writeBrain(
      "memories.jsonl",
      [
        JSON.stringify({
          id: "mem_active",
          kind: "decision",
          text: "widget pipeline uses the active path",
          severity: "medium",
          createdAt: new Date(NOW).toISOString(),
          status: "active",
        }),
        JSON.stringify({
          id: "mem_archived",
          kind: "decision",
          text: "widget pipeline once used the archived path",
          severity: "medium",
          createdAt: new Date(NOW).toISOString(),
          status: "archived",
        }),
        JSON.stringify({
          id: "mem_expired",
          kind: "decision",
          text: "widget pipeline temporarily used the expired path",
          severity: "medium",
          createdAt: new Date(NOW - 1000).toISOString(),
          status: "active",
          expiresAt: new Date(NOW - 1).toISOString(),
        }),
        JSON.stringify({
          id: "mem_garbage_expiry",
          kind: "decision",
          text: "widget pipeline briefly used the corrupt path",
          severity: "medium",
          createdAt: new Date(NOW - 1000).toISOString(),
          status: "active",
          expiresAt: "not-a-real-date", // Date.parse -> NaN; must be excluded
        }),
      ].join("\n"),
    );

    const out = await puntaxContext(
      { task: "widget pipeline path", projectDir, mode: "debug" },
      { config: config(), now: NOW },
    );

    expect(out.context).toContain("active path");
    expect(out.context).not.toContain("archived path");
    expect(out.context).not.toContain("expired path");
    expect(out.context).not.toContain("corrupt path");
  });

  it("ranks a critical typed memory above a low-severity lesson", async () => {
    writeBrain(
      "memories.jsonl",
      JSON.stringify({
        id: "mem_crit",
        kind: "constraint",
        text: "never mutate the shared ranker cache",
        severity: "critical",
        createdAt: new Date(NOW).toISOString(),
        status: "active",
      }),
    );
    writeBrain(
      "lessons.jsonl",
      JSON.stringify({
        timestamp: new Date(NOW).toISOString(),
        type: "note",
        lesson: "the ranker cache lives in memory",
        severity: "low",
      }),
    );

    const out = await puntaxContext(
      { task: "ranker cache", projectDir, mode: "debug" },
      { config: config(), now: NOW },
    );

    expect(out.context.split("\n")[0]).toContain("never mutate");
    expect(out.sources[0].kind).toBe("memory");
  });

  it("ranks a durable decision above a routine test_command of equal severity", async () => {
    // Same severity, recency, and keyword overlap → only the kind bias differs,
    // so the decision (boosted) must outrank the test_command (penalized).
    writeBrain(
      "memories.jsonl",
      [
        JSON.stringify({
          id: "mem_cmd",
          kind: "test_command",
          scope: "project",
          text: "npx vitest run for the parser suite",
          severity: "medium",
          createdAt: new Date(NOW).toISOString(),
          status: "active",
        }),
        JSON.stringify({
          id: "mem_dec",
          kind: "decision",
          scope: "project",
          text: "the parser suite runs under vitest by team decision",
          severity: "medium",
          createdAt: new Date(NOW).toISOString(),
          status: "active",
        }),
      ].join("\n"),
    );

    const out = await puntaxContext(
      { task: "parser suite vitest", projectDir, mode: "debug" },
      { config: config(), now: NOW },
    );

    const lines = out.context.split("\n");
    const decIdx = lines.findIndex((l) => l.includes("by team decision"));
    const cmdIdx = lines.findIndex((l) => l.includes("npx vitest run"));
    expect(decIdx).toBeGreaterThanOrEqual(0);
    expect(cmdIdx).toBeGreaterThanOrEqual(0);
    expect(decIdx).toBeLessThan(cmdIdx);
  });
});
