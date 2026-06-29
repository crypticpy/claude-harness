import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CodeMap, projectIdFor, fileIdFor } from "../src/storage/code-map";
import { indexProject, resolveImport } from "../src/indexer/code-indexer";

let projectDir: string;
let dbPath: string;
let clockValue: number;

function mkClock() {
  clockValue = 1000;
  return () => ++clockValue;
}

function write(rel: string, content: string): void {
  const abs = path.join(projectDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-codemap-"));
  dbPath = path.join(projectDir, ".claude", "context-layer", "code-map.db");
});
afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("CodeMap store", () => {
  it("derives deterministic project/file ids", () => {
    const pid = projectIdFor("/repo");
    expect(pid).toBe(projectIdFor("/repo"));
    expect(pid).not.toBe(projectIdFor("/other"));
    expect(fileIdFor(pid, "a.ts")).toBe(fileIdFor(pid, "a.ts"));
    expect(fileIdFor(pid, "a.ts")).not.toBe(fileIdFor(pid, "b.ts"));
  });

  it("upserts a file idempotently and replaces its symbols", () => {
    const cm = new CodeMap({ dbPath: ":memory:", clock: mkClock() });
    const pid = cm.ensureProject("/repo", "repo");
    const fid = cm.upsertFile({
      projectId: pid,
      path: "a.ts",
      language: "typescript",
      hash: "h1",
      mtime: 1,
      sizeBytes: 10,
      lineCount: 5,
    });
    cm.replaceFileSymbols(pid, fid, [
      {
        kind: "function",
        name: "foo",
        qualifiedName: "foo",
        parentSymbolId: null,
        startLine: 1,
        endLine: 1,
        startByte: null,
        endByte: null,
        signature: "foo()",
        doc: null,
        confidence: "inferred",
      },
    ]);
    expect(cm.getSymbolsByName(pid, "foo")).toHaveLength(1);

    // Re-index same file with a different symbol set -> old symbols gone.
    cm.upsertFile({
      projectId: pid,
      path: "a.ts",
      language: "typescript",
      hash: "h2",
      mtime: 2,
      sizeBytes: 11,
      lineCount: 6,
    });
    cm.replaceFileSymbols(pid, fid, [
      {
        kind: "function",
        name: "bar",
        qualifiedName: "bar",
        parentSymbolId: null,
        startLine: 1,
        endLine: 1,
        startByte: null,
        endByte: null,
        signature: "bar()",
        doc: null,
        confidence: "inferred",
      },
    ]);
    expect(cm.getSymbolsByName(pid, "foo")).toHaveLength(0);
    expect(cm.getSymbolsByName(pid, "bar")).toHaveLength(1);
    expect(cm.counts(pid).files).toBe(1);
    cm.close();
  });
});

describe("indexProject (regex backend)", () => {
  it("writes real file/symbol rows and resolves import edges", () => {
    write(
      "src/util.ts",
      `export function helper(x: number): number { return x + 1; }\n`,
    );
    write(
      "src/main.ts",
      `import { helper } from './util';\nexport function run() { return helper(1); }\n`,
    );

    const cm = new CodeMap({ dbPath, clock: mkClock() });
    const res = indexProject(cm, projectDir);

    expect(res.filesIndexed).toBe(2);
    expect(res.filesSeen).toBe(2);

    const helper = cm.getSymbolsByName(res.projectId, "helper");
    expect(helper).toHaveLength(1);
    expect(helper[0].confidence).toBe("inferred");

    // main.ts -> util.ts import edge.
    const utilFileId = fileIdFor(res.projectId, "src/util.ts");
    const incoming = cm.edgesTargetingFile(res.projectId, utilFileId);
    expect(incoming.some((e) => e.kind === "imports")).toBe(true);
    expect(incoming[0].confidence).toBe("resolved");

    const run = cm.latestRun(res.projectId);
    expect(run?.filesIndexed).toBe(2);
    expect(run?.finishedAt).not.toBeNull();
    cm.close();
  });

  it("records extends/implements relations as symbol edges", () => {
    write("src/base.ts", `export class Base {}\n`);
    write(
      "src/child.ts",
      `import { Base } from './base';\nexport class Child extends Base {}\n`,
    );

    const cm = new CodeMap({ dbPath, clock: mkClock() });
    const res = indexProject(cm, projectDir);

    const base = cm.getSymbolsByName(res.projectId, "Base")[0];
    const extendsEdges = cm
      .edgesTargetingSymbol(base.id)
      .filter((e) => e.kind === "extends");
    expect(extendsEdges).toHaveLength(1);
    expect(extendsEdges[0].confidence).toBe("resolved");
    cm.close();
  });

  it("preserves inbound relation edges when only the target file is re-indexed", () => {
    write("src/base.ts", `export class Base {}\n`);
    write(
      "src/child.ts",
      `import { Base } from './base';\nexport class Child extends Base {}\n`,
    );

    const cm = new CodeMap({ dbPath, clock: mkClock() });
    const res = indexProject(cm, projectDir);
    const baseBefore = cm.getSymbolsByName(res.projectId, "Base")[0];
    expect(
      cm
        .edgesTargetingSymbol(baseBefore.id)
        .filter((e) => e.kind === "extends"),
    ).toHaveLength(1);

    // Edit base.ts (child.ts untouched) such that Base's line — and thus its
    // deterministic id — shifts. Refresh incrementally on base.ts alone.
    write("src/base.ts", `// touched\nexport class Base {\n  greet() {}\n}\n`);
    indexProject(cm, projectDir, {
      mode: "incremental",
      changedFiles: ["src/base.ts"],
    });

    // The Child-extends-Base edge must survive and re-point to the new Base id,
    // even though child.ts was never re-parsed. (Before the Phase C reverse-
    // dependent rebuild, the symbol-FK cascade silently dropped this edge.)
    const baseAfter = cm.getSymbolsByName(res.projectId, "Base")[0];
    const extendsEdges = cm
      .edgesTargetingSymbol(baseAfter.id)
      .filter((e) => e.kind === "extends");
    expect(extendsEdges).toHaveLength(1);
    expect(extendsEdges[0].sourceFileId).toBe(
      fileIdFor(res.projectId, "src/child.ts"),
    );
    cm.close();
  });

  it("detects staleness and skips unchanged files on re-index", () => {
    write("src/a.ts", `export function a() {}\n`);
    const cm = new CodeMap({ dbPath, clock: mkClock() });
    const first = indexProject(cm, projectDir);
    expect(first.filesIndexed).toBe(1);

    // Re-index with no content change -> unchanged file skipped.
    const second = indexProject(cm, projectDir);
    expect(second.filesSeen).toBe(1);
    expect(second.filesIndexed).toBe(0);
    cm.close();
  });

  it("incremental mode re-indexes only changed files and drops deleted ones", () => {
    write("src/a.ts", `export function a() {}\n`);
    write("src/b.ts", `export function b() {}\n`);
    const cm = new CodeMap({ dbPath, clock: mkClock() });
    indexProject(cm, projectDir);
    expect(cm.counts(cm.ensureProject(projectDir, "x")).files).toBe(2);

    // Change a.ts, delete b.ts, refresh just those two.
    write("src/a.ts", `export function a() {}\nexport function a2() {}\n`);
    fs.rmSync(path.join(projectDir, "src/b.ts"));
    const res = indexProject(cm, projectDir, {
      mode: "incremental",
      changedFiles: ["src/a.ts", "src/b.ts"],
    });
    expect(res.filesIndexed).toBe(1); // only a.ts re-parsed
    expect(cm.getSymbolsByName(res.projectId, "a2")).toHaveLength(1);
    expect(cm.getSymbolsByName(res.projectId, "b")).toHaveLength(0);
    expect(cm.counts(res.projectId).files).toBe(1);
    cm.close();
  });
});

describe("resolveImport", () => {
  const fileSet = new Map<string, string>([
    ["src/util.ts", "x"],
    ["src/nested/index.ts", "y"],
    ["pkg/mod.py", "z"],
    ["pkg/__init__.py", "w"],
  ]);

  it("resolves relative TS imports with extension inference", () => {
    expect(resolveImport("src/main.ts", "./util", "typescript", fileSet)).toBe(
      "src/util.ts",
    );
    expect(
      resolveImport("src/main.ts", "./util.js", "typescript", fileSet),
    ).toBe("src/util.ts");
    expect(
      resolveImport("src/main.ts", "./nested", "typescript", fileSet),
    ).toBe("src/nested/index.ts");
  });

  it("returns null for bare/external modules", () => {
    expect(resolveImport("src/main.ts", "react", "typescript", fileSet)).toBe(
      null,
    );
  });

  it("resolves python module + package imports", () => {
    expect(resolveImport("app.py", "pkg.mod", "python", fileSet)).toBe(
      "pkg/mod.py",
    );
    expect(resolveImport("app.py", "pkg", "python", fileSet)).toBe(
      "pkg/__init__.py",
    );
  });
});
