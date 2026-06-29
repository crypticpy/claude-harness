import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  deriveMemories,
  runAutoDistill,
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
