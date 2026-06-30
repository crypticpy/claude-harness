import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { whatChanged, sampleDiff } from "../src/tools/what-changed";

/** Initialize a throwaway git repo so the git-history path has something to read. */
function gitInit(dir: string): void {
  const run = (argv: string[]) =>
    execFileSync("git", argv, { cwd: dir, encoding: "utf-8" });
  run(["init", "-q"]);
  run(["config", "user.email", "t@example.com"]);
  run(["config", "user.name", "Test"]);
  run(["config", "commit.gpgsign", "false"]);
}

function gitCommit(dir: string, file: string, body: string, message: string): void {
  fs.writeFileSync(path.join(dir, file), body);
  execFileSync("git", ["add", file], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
}

describe("sampleDiff — middle sampling preserves both ends", () => {
  it("returns the diff unchanged when within budget", () => {
    const small = "line1\nline2\nline3";
    expect(sampleDiff(small, 2000)).toBe(small);
  });

  it("keeps head and tail with an omission marker when over budget", () => {
    const head = "HEAD_MARKER_START\n" + "a\n".repeat(400);
    const tail = "z\n".repeat(400) + "TAIL_MARKER_END";
    const big = head + tail;
    const out = sampleDiff(big, 400);
    expect(out).toContain("HEAD_MARKER_START"); // head survived
    expect(out).toContain("TAIL_MARKER_END"); // tail survived (head-only trunc would lose it)
    expect(out).toContain("omitted in the middle");
    expect(out.length).toBeLessThan(big.length);
  });
});

let projectDir: string;
const saved = {
  flag: process.env.PUNTAX_EVENT_LEDGER,
  cfg: process.env.PUNTAX_CONFIG_PATH,
};

function writeEvents(...events: Record<string, unknown>[]): void {
  const dir = path.join(projectDir, ".claude", "context-layer");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "events.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-wc-"));
  // Force a deterministic config: point at a nonexistent file so loadPuntaxConfig
  // falls to defaults, then let the env flag decide eventLedger.enabled.
  process.env.PUNTAX_CONFIG_PATH = path.join(projectDir, "no-such-config.json");
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
  if (saved.flag === undefined) delete process.env.PUNTAX_EVENT_LEDGER;
  else process.env.PUNTAX_EVENT_LEDGER = saved.flag;
  if (saved.cfg === undefined) delete process.env.PUNTAX_CONFIG_PATH;
  else process.env.PUNTAX_CONFIG_PATH = saved.cfg;
});

describe("whatChanged — event ledger", () => {
  it("includes recent ledger events for the file when the ledger is enabled", async () => {
    process.env.PUNTAX_EVENT_LEDGER = "true";
    writeEvents(
      {
        id: "evt_1",
        kind: "edit",
        ts: "2026-06-29T00:00:00.000Z",
        tool: "Edit",
        outcome: "ok",
        files: ["src/foo.ts"],
        summary: "edit foo",
      },
      {
        id: "evt_2",
        kind: "read",
        ts: "2026-06-29T01:00:00.000Z",
        tool: "Read",
        outcome: "ok",
        files: ["src/other.ts"],
      },
    );

    const res = await whatChanged({
      filePath: "src/foo.ts",
      projectPath: projectDir,
    });
    expect(res.ledgerEvents).toBeDefined();
    expect(res.ledgerEvents).toHaveLength(1);
    expect(res.ledgerEvents![0].kind).toBe("edit");
  });

  it("omits ledger events when the ledger is disabled", async () => {
    process.env.PUNTAX_EVENT_LEDGER = "false";
    writeEvents({
      id: "evt_1",
      kind: "edit",
      ts: "2026-06-29T00:00:00.000Z",
      outcome: "ok",
      files: ["src/foo.ts"],
    });

    const res = await whatChanged({
      filePath: "src/foo.ts",
      projectPath: projectDir,
    });
    expect(res.ledgerEvents).toBeUndefined();
  });

  it("does not throw when there is no ledger file", async () => {
    process.env.PUNTAX_EVENT_LEDGER = "true";
    const res = await whatChanged({
      filePath: "src/foo.ts",
      projectPath: projectDir,
    });
    expect(res.ledgerEvents).toBeUndefined();
    expect(res.filePath).toContain("foo.ts");
  });
});

describe("whatChanged — git history (argv, no shell injection)", () => {
  beforeEach(() => {
    // Isolate the git path; the ledger has its own tests above.
    process.env.PUNTAX_EVENT_LEDGER = "false";
  });

  it("returns recent commits and a line count for a tracked file", async () => {
    gitInit(projectDir);
    gitCommit(projectDir, "tracked.ts", "export const a = 1;\n", "add tracked");

    const res = await whatChanged({
      filePath: "tracked.ts",
      projectPath: projectDir,
      since: "5 commits",
    });
    expect(res.recentCommits.length).toBeGreaterThan(0);
    expect(res.recentCommits[0].message).toBe("add tracked");
    expect(res.totalLinesChanged).toBeGreaterThan(0);
  });

  it("does not execute shell metacharacters embedded in the file path", async () => {
    gitInit(projectDir);
    // If git ran through a shell, `; touch PWNED` would fire as a second command
    // and create the sentinel in cwd (projectDir). execFileSync passes argv with
    // no shell, so this is just an (absent) pathspec.
    const evil = 'nope.ts"; touch PWNED; echo "';
    const res = await whatChanged({ filePath: evil, projectPath: projectDir });
    expect(fs.existsSync(path.join(projectDir, "PWNED"))).toBe(false);
    expect(res.hasUncommittedChanges).toBe(false);
    expect(res.recentCommits).toEqual([]);
  });

  it('treats a "since" that says commit but carries no number as a sane default', async () => {
    gitInit(projectDir);
    gitCommit(projectDir, "x.ts", "1\n", "c1");
    // Previously "commits" → `-n NaN`, which git rejects and the whole log breaks.
    const res = await whatChanged({
      filePath: "x.ts",
      projectPath: projectDir,
      since: "commits",
    });
    expect(res.recentCommits.length).toBeGreaterThan(0);
  });
});
