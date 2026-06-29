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
});
