import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const { writeEvent } = await import("../../../hooks/unified/modules/event-writer.mjs");
const { analyzeFlakyTests, buildFlakyReport } = await import(
  "../../../hooks/unified/modules/flaky-tests.mjs"
);
const { recordBaseline, diffExportSurface, exportNamesIn } = await import(
  "../../../hooks/unified/modules/export-surface.mjs"
);

let projectDir: string;

beforeEach(() => {
  projectDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "tripwires-")),
  );
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

function testEvent(session: string, command: string, outcome: "ok" | "error") {
  writeEvent(
    { sessionId: session, kind: "test", tool: "Bash", command, outcome },
    { projectDir },
  );
}

describe("flaky-test ledger", () => {
  it("flags a command whose outcome flips ≥2 times across sessions", () => {
    testEvent("s1", "npx vitest run", "error");
    testEvent("s1", "npx vitest run", "ok");
    testEvent("s2", "npx vitest run", "error");
    testEvent("s2", "npx vitest run", "ok");

    const flaky = analyzeFlakyTests(projectDir);
    expect(flaky).toHaveLength(1);
    expect(flaky[0]).toMatchObject({ runs: 4, passes: 2, fails: 2, flips: 3 });
  });

  it("does NOT flag a legitimate fix (fail…fail → pass…pass, one flip)", () => {
    testEvent("s1", "npm test", "error");
    testEvent("s1", "npm test", "error");
    testEvent("s1", "npm test", "ok");
    testEvent("s2", "npm test", "ok");

    expect(analyzeFlakyTests(projectDir)).toHaveLength(0);
  });

  it("groups near-duplicate commands via normalizeCommand (redirects stripped)", () => {
    testEvent("s1", "npx vitest run 2>&1", "error");
    testEvent("s1", "npx vitest run", "ok");
    testEvent("s2", "npx vitest run >out.log", "error");
    testEvent("s2", "npx vitest run", "ok");

    const flaky = analyzeFlakyTests(projectDir);
    expect(flaky).toHaveLength(1);
    expect(flaky[0].runs).toBe(4);
  });

  it("buildFlakyReport gates on commands actually run in the reporting session", () => {
    testEvent("s1", "npx vitest run", "error");
    testEvent("s1", "npx vitest run", "ok");
    testEvent("s2", "npx vitest run", "error");
    testEvent("s2", "npx vitest run", "ok");

    // s3 never ran the flaky command → silent.
    testEvent("s3", "cargo test", "ok");
    expect(buildFlakyReport(projectDir, "s3")).toBeNull();

    // s2 did run it → reported.
    const report = buildFlakyReport(projectDir, "s2");
    expect(report).toContain("[flaky]");
    expect(report).toContain("npx vitest run");
  });
});

// ---------------------------------------------------------------------------

function git(...args: string[]) {
  return execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", ...args],
    { cwd: projectDir, stdio: ["ignore", "pipe", "pipe"] },
  )
    .toString()
    .trim();
}

function initRepoWith(file: string, content: string) {
  git("init", "-q");
  fs.mkdirSync(path.dirname(path.join(projectDir, file)), { recursive: true });
  fs.writeFileSync(path.join(projectDir, file), content);
  git("add", "-A");
  git("commit", "-qm", "base");
}

function editEventFor(session: string, file: string) {
  writeEvent(
    { sessionId: session, kind: "edit", tool: "Edit", files: [file] },
    { projectDir },
  );
}

describe("export-surface tripwire", () => {
  it("parses export names from JS/TS surface syntax", () => {
    expect(exportNamesIn("export function foo() {")).toEqual(["foo"]);
    expect(exportNamesIn("export const bar = 1;")).toEqual(["bar"]);
    expect(exportNamesIn("export { a, b as c }")).toEqual(["a", "c"]);
    expect(exportNamesIn("export default thing")).toEqual(["default"]);
    expect(exportNamesIn("const notExported = 1;")).toEqual([]);
  });

  it("warns when a session's edits remove a public export", () => {
    initRepoWith("src/a.ts", "export function keep() {}\nexport function gone() {}\n");
    recordBaseline({ session_id: "s1", cwd: projectDir, source: "startup" }, { projectDir });

    fs.writeFileSync(path.join(projectDir, "src/a.ts"), "export function keep() {}\n");
    editEventFor("s1", "src/a.ts");

    const warning = diffExportSurface(
      { session_id: "s1", cwd: projectDir },
      { projectDir },
    );
    expect(warning).toContain("[api]");
    expect(warning).toContain("src/a.ts");
    expect(warning).toContain("gone");
    expect(warning).not.toContain("keep");
  });

  it("stays silent when exports only move or grow", () => {
    initRepoWith("src/a.ts", "export function alpha() {}\n");
    recordBaseline({ session_id: "s1", cwd: projectDir, source: "startup" }, { projectDir });

    // alpha moves down a line and beta is added — surface intact.
    fs.writeFileSync(
      path.join(projectDir, "src/a.ts"),
      "// moved\nexport function alpha() {}\nexport function beta() {}\n",
    );
    editEventFor("s1", "src/a.ts");

    expect(
      diffExportSurface({ session_id: "s1", cwd: projectDir }, { projectDir }),
    ).toBeNull();
  });

  it("catches removals hidden behind a mid-session commit (baseline pin)", () => {
    initRepoWith("src/a.ts", "export function gone() {}\n");
    recordBaseline({ session_id: "s1", cwd: projectDir, source: "startup" }, { projectDir });

    // The session removes the export AND commits — a plain HEAD diff would be clean.
    fs.writeFileSync(path.join(projectDir, "src/a.ts"), "function gone() {}\n");
    git("add", "-A");
    git("commit", "-qm", "mid-session");
    editEventFor("s1", "src/a.ts");

    const warning = diffExportSurface(
      { session_id: "s1", cwd: projectDir },
      { projectDir },
    );
    expect(warning).toContain("gone");
  });

  it("compaction keeps the original baseline; a new session re-pins", () => {
    initRepoWith("src/a.ts", "export const x = 1;\n");
    const first = recordBaseline(
      { session_id: "s1", cwd: projectDir, source: "startup" },
      { projectDir },
    );
    const afterCompact = recordBaseline(
      { session_id: "s1", cwd: projectDir, source: "compact" },
      { projectDir },
    );
    expect(afterCompact).toBeNull(); // compact never re-pins

    fs.writeFileSync(path.join(projectDir, "src/a.ts"), "export const x = 2;\n");
    git("add", "-A");
    git("commit", "-qm", "advance head");

    const second = recordBaseline(
      { session_id: "s2", cwd: projectDir, source: "startup" },
      { projectDir },
    );
    expect(second?.head).not.toBe(first?.head);
  });

  it("is silent in non-git projects", () => {
    // No git init — both entry points fail open.
    expect(
      recordBaseline({ session_id: "s1", cwd: projectDir, source: "startup" }, { projectDir }),
    ).toBeNull();
    editEventFor("s1", "src/a.ts");
    expect(
      diffExportSurface({ session_id: "s1", cwd: projectDir }, { projectDir }),
    ).toBeNull();
  });
});
