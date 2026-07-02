import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  deriveMemories,
  runAutoDistill,
  normalizeCommand,
} from "../../../hooks/unified/modules/auto-distill.mjs";
import {
  readMemories,
  projectIdFor,
} from "../../../hooks/unified/modules/memory-store.mjs";

const PRJ = "prj_test";

describe("deriveMemories — pure derivation", () => {
  it("extracts distinct test_command memories from test events", () => {
    const out = deriveMemories(
      [
        { kind: "test", command: "npx vitest run", outcome: "ok" },
        { kind: "test", command: "npx vitest run", outcome: "error" }, // dup cmd
        { kind: "test", command: "pytest -q", outcome: "ok" },
        { kind: "edit", command: "noop", files: ["a.ts"], outcome: "ok" },
      ],
      PRJ,
    );
    const cmds = out.filter((m) => m.kind === "test_command");
    expect(cmds.map((m) => m.text).sort()).toEqual([
      "npx vitest run",
      "pytest -q",
    ]);
    expect(cmds[0].confidence).toBe("observed");
    expect(cmds[0].provenance.source).toBe("event");
    expect(cmds[0].scope).toBe("project");
  });

  it("emits failure_pattern only for files that errored and were not re-edited cleanly", () => {
    const out = deriveMemories(
      [
        {
          kind: "edit",
          files: ["broken.ts"],
          outcome: "error",
          summary: "TS2322",
        },
        {
          kind: "edit",
          files: ["fixed.ts"],
          outcome: "error",
          summary: "boom",
        },
        { kind: "edit", files: ["fixed.ts"], outcome: "ok" }, // resolved later
      ],
      PRJ,
    );
    const fails = out.filter((m) => m.kind === "failure_pattern");
    expect(fails).toHaveLength(1);
    expect(fails[0].files).toEqual(["broken.ts"]);
    expect(fails[0].scope).toBe("file");
    expect(fails[0].severity).toBe("medium");
    expect(fails[0].text).toContain("broken.ts");
  });

  it("returns [] for no events", () => {
    expect(deriveMemories([], PRJ)).toEqual([]);
    expect(deriveMemories(null as any, PRJ)).toEqual([]);
  });

  it("collapses output-plumbing variants of one command to a single memory", () => {
    const out = deriveMemories(
      [
        { kind: "test", command: "npx vitest run", outcome: "ok" },
        { kind: "test", command: "npx vitest run 2>&1 | tail -30", outcome: "error" },
        { kind: "test", command: "npx vitest run > out.log", outcome: "ok" },
        { kind: "test", command: "npx vitest run | grep FAIL | head", outcome: "ok" },
      ],
      PRJ,
    );
    const cmds = out.filter((m) => m.kind === "test_command");
    // All four are the same logical command after normalization → one memory.
    expect(cmds).toHaveLength(1);
    expect(cmds[0].text).toBe("npx vitest run");
  });

  it("adds a TTL (expiresAt) only when a clock is supplied", () => {
    const events = [{ kind: "test", command: "npx vitest run", outcome: "ok" }];
    // Pure call (no clock) → no expiry, so existing tests stay deterministic.
    expect(deriveMemories(events, PRJ)[0].expiresAt).toBeUndefined();
    // With a clock → expiresAt is now + ttlDays so observations age out.
    const now = Date.parse("2026-06-30T00:00:00Z");
    const out = deriveMemories(events, PRJ, { now, ttlDays: 90 });
    expect(out[0].expiresAt).toBe(new Date(now + 90 * 86400000).toISOString());
  });
});

describe("normalizeCommand — output-plumbing canonicalization", () => {
  it("strips redirects and trailing output filters", () => {
    expect(normalizeCommand("npx vitest run 2>&1 | tail -30")).toBe("npx vitest run");
    expect(normalizeCommand("pytest -q > out.log")).toBe("pytest -q");
    expect(normalizeCommand("go test ./... 2>/dev/null")).toBe("go test ./...");
    expect(normalizeCommand("cargo test | grep -i fail | head")).toBe("cargo test");
  });

  it("keeps meaningful (non-filter) pipe stages and collapses whitespace", () => {
    expect(normalizeCommand("foo  |  xargs bar")).toBe("foo | xargs bar");
    expect(normalizeCommand("  npx   vitest   run  ")).toBe("npx vitest run");
  });

  it("treats `||` as logical-or, not a pipe to split on", () => {
    // `||` must survive intact — splitting it forks one command into mangled
    // near-duplicates that defeat dedup. Spaced and unspaced forms both hold.
    expect(normalizeCommand("make test || echo fail")).toBe("make test || echo fail");
    expect(normalizeCommand("a||b")).toBe("a||b");
    // A real single pipe to an output filter is still stripped after the `||`.
    expect(normalizeCommand("npm test || exit 1 | tail")).toBe("npm test || exit 1");
  });

  it("handles empty / nullish input", () => {
    expect(normalizeCommand("")).toBe("");
    expect(normalizeCommand(null as any)).toBe("");
    expect(normalizeCommand(undefined as any)).toBe("");
  });

  it("strips leading echo banner segments only", () => {
    expect(normalizeCommand('echo "=== suite ===" && npx vitest run')).toBe(
      "npx vitest run",
    );
    expect(normalizeCommand("echo a && echo b && npm test")).toBe("npm test");
    expect(normalizeCommand("echo hi; pytest -q")).toBe("pytest -q");
    // Quoted control operators inside the banner don't confuse the strip.
    expect(normalizeCommand('echo "a && b" && pytest -q')).toBe("pytest -q");
    // Interior echo separates real stages of a compound line — leave it.
    expect(normalizeCommand("npm run build && echo done && npx vitest run")).toBe(
      "npm run build && echo done && npx vitest run",
    );
    // `echo` after `||` is control flow, not decoration.
    expect(normalizeCommand("make test || echo fail")).toBe("make test || echo fail");
    // `echo`-prefixed executables are not banners.
    expect(normalizeCommand("echo-server && npm test")).toBe("echo-server && npm test");
  });

  it("keeps setup echoes — an unquoted redirect means the echo does work", () => {
    // Writing a file is setup, not a banner; the echo segment survives (its
    // redirect target is still stripped by the pre-existing redirect pass).
    expect(normalizeCommand("echo FOO=bar > .env && npm test")).toBe(
      "echo FOO=bar && npm test",
    );
    expect(normalizeCommand("echo data >> fixtures.txt && pytest -q")).toBe(
      "echo data && pytest -q",
    );
    // A QUOTED angle bracket is content, not a redirect — still a banner.
    expect(normalizeCommand('echo "a > b" && pytest -q')).toBe("pytest -q");
  });
});

describe("runAutoDistill — writes typed memory, dedups, fail-open", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-distill-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const events = [
    {
      session_id: "s1",
      kind: "test",
      command: "npx vitest run",
      outcome: "ok",
    },
    {
      session_id: "s1",
      kind: "edit",
      files: ["x.ts"],
      outcome: "error",
      summary: "explode",
    },
  ];

  it("derives and writes memories from the session's events", () => {
    const readEvents = () => events;
    const res = runAutoDistill(
      { session_id: "s1" },
      { projectDir: dir, deps: { readEvents } },
    );
    expect(res.candidates).toBe(2);
    expect(res.written).toBe(2);
    const mems = readMemories(dir);
    expect(mems.map((m) => m.kind).sort()).toEqual([
      "failure_pattern",
      "test_command",
    ]);
    // ids are content-addressed off the resolved project path
    const pid = projectIdFor(path.resolve(dir));
    expect(mems.every((m) => m.projectId === pid)).toBe(true);
  });

  it("is idempotent across runs (content-addressed dedup)", () => {
    const readEvents = () => events;
    runAutoDistill(
      { session_id: "s1" },
      { projectDir: dir, deps: { readEvents } },
    );
    const second = runAutoDistill(
      { session_id: "s1" },
      { projectDir: dir, deps: { readEvents } },
    );
    expect(second.written).toBe(0); // already present
    expect(readMemories(dir)).toHaveLength(2);
  });

  it("no session_id / no events → no writes, never throws", () => {
    expect(runAutoDistill({}, { projectDir: dir }).written).toBe(0);
    const empty = runAutoDistill(
      { session_id: "s1" },
      { projectDir: dir, deps: { readEvents: () => [] } },
    );
    expect(empty.written).toBe(0);
    expect(readMemories(dir)).toHaveLength(0);
  });
});
