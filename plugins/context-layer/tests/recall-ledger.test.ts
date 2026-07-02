import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { brainSearch } from "../src/tools/brain-tools";
import { puntaxContext } from "../src/tools/puntax-context";
import { DEFAULT_PUNTAX } from "../src/config/puntax-config";

// The consumer of these events is the HOOK runtime (never-recalled prune in
// precompact-reducer), so parity is asserted through the live .mjs reader.
const { countMemoryRecalls } = await import(
  "../../../hooks/unified/modules/event-writer.mjs"
);

const NOW = 1_700_000_000_000;
let projectDir: string;
let brainDir: string;

function eventsFile(): string {
  return path.join(brainDir, "events.jsonl");
}

function readRecallEvents(): any[] {
  if (!fs.existsSync(eventsFile())) return [];
  return fs
    .readFileSync(eventsFile(), "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((e) => e.kind === "memory_recall");
}

function writeMemory(id: string, text: string, extra: object = {}): string {
  const row = {
    id,
    kind: "gotcha",
    scope: "repo",
    text,
    severity: "high",
    createdAt: new Date(NOW).toISOString(),
    status: "active",
    ...extra,
  };
  fs.appendFileSync(
    path.join(brainDir, "memories.jsonl"),
    JSON.stringify(row) + "\n",
  );
  return id;
}

beforeEach(() => {
  projectDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "recall-ledger-")),
  );
  brainDir = path.join(projectDir, ".claude", "context-layer");
  fs.mkdirSync(brainDir, { recursive: true });
  // recordMemoryRecall gates on ambient config — pin the env override so the
  // tests don't depend on this machine's ~/.claude config.json.
  process.env.PUNTAX_EVENT_LEDGER = "true";
});

afterEach(() => {
  delete process.env.PUNTAX_EVENT_LEDGER;
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("MCP-side recall telemetry", () => {
  it("brain_search records one memory_recall event with the returned mem_* ids", async () => {
    const id = writeMemory("mem_aaa111", "authentication tokens must refresh");
    writeMemory("mem_bbb222", "unrelated database vacuum trick");

    const out = await brainSearch({
      query: "authentication token refresh",
      projectPath: projectDir,
    });
    expect(out.results.some((r) => r.source === "memory")).toBe(true);

    const events = readRecallEvents();
    expect(events).toHaveLength(1);
    expect(events[0].meta.ids).toContain(id);
    expect(events[0].meta.ids).not.toContain("mem_bbb222");
    expect(events[0].meta.via).toBe("brain_search");
  });

  it("puntax_context records recalled memory ids but never convention names", async () => {
    const id = writeMemory("mem_ccc333", "steering charter re-injects verbatim");
    fs.writeFileSync(
      path.join(brainDir, "conventions.json"),
      JSON.stringify({
        patterns: {
          "steering-naming": {
            location: "src",
            description: "steering charter modules use kebab-case",
          },
        },
      }),
    );

    await puntaxContext(
      { task: "extend the steering charter re-injection", projectDir, mode: "debug" },
      { config: structuredClone(DEFAULT_PUNTAX), now: NOW },
    );

    const events = readRecallEvents();
    expect(events).toHaveLength(1);
    expect(events[0].meta.ids).toEqual([id]);
    expect(events[0].meta.via).toBe("puntax_context");
  });

  it("writes nothing when no typed memory is recalled", async () => {
    await brainSearch({ query: "nothing matches this", projectPath: projectDir });
    await puntaxContext(
      { task: "nothing matches this either", projectDir, mode: "prompt" },
      { config: structuredClone(DEFAULT_PUNTAX), now: NOW },
    );
    expect(readRecallEvents()).toHaveLength(0);
  });

  it("events fold into recall counts through the hook-side reader (cross-runtime parity)", async () => {
    const id = writeMemory("mem_ddd444", "flaky ledger needs two outcome flips");

    await brainSearch({ query: "flaky ledger outcome flips", projectPath: projectDir });
    await puntaxContext(
      { task: "tune the flaky ledger outcome flips", projectDir, mode: "debug" },
      { config: structuredClone(DEFAULT_PUNTAX), now: NOW },
    );

    const counts = countMemoryRecalls(projectDir);
    expect(counts.get(id)).toBe(2);
  });
});
