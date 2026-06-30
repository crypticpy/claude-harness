import { describe, it, expect, beforeAll, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  TreeSitterBackend,
  warmTreeSitter,
} from "../src/indexer/backends/tree-sitter";
import { RegexBackend } from "../src/indexer/backends/regex";
import { pickBackend } from "../src/indexer/code-indexer";
import {
  ensureProjectIndexed,
  openCodeMap,
} from "../src/indexer/code-map-service";
import { projectIdFor } from "../src/storage/code-map";
import type { BackendParseResult } from "../src/indexer/backends/types";

let backend: TreeSitterBackend;

beforeAll(async () => {
  // Warm the singleton so readyTreeSitterBackend() (and thus the service's
  // defaultBackends()) sees it — exercises the same path as the live server.
  backend = (await warmTreeSitter())!;
});

const ts = (src: string): BackendParseResult => backend.parse(src, "mod.ts");
const py = (src: string): BackendParseResult => backend.parse(src, "mod.py");
const exportKinds = (r: BackendParseResult) =>
  new Map(r.exports.map((e) => [e.name, e.kind]));

describe("TreeSitterBackend — availability + selection", () => {
  it("loads grammars and supports TS + Python", () => {
    expect(backend.isAvailable()).toBe(true);
    expect(backend.supports("typescript")).toBe(true);
    expect(backend.supports("python")).toBe(true);
    expect(backend.supports("ruby")).toBe(false);
  });

  it("is picked ahead of regex for supported languages", () => {
    const chosen = pickBackend("typescript", [backend, new RegexBackend()]);
    expect(chosen?.name).toBe("tree-sitter");
    expect(backend.tier).toBe("extracted");
  });
});

describe("TreeSitterBackend — TS export classification (from the AST)", () => {
  it("classifies each export by its real declaration keyword", () => {
    const r = ts(
      [
        "export function foo() {}",
        "export class Bar {}",
        "export const baz = 1;",
        "export interface Iface {}",
        "export type Alias = string;",
        "export enum Color { Red }",
      ].join("\n"),
    );
    const k = exportKinds(r);
    expect(k.get("foo")).toBe("function");
    expect(k.get("Bar")).toBe("class");
    expect(k.get("baz")).toBe("const");
    expect(k.get("Iface")).toBe("interface");
    expect(k.get("Alias")).toBe("type");
    expect(k.get("Color")).toBe("enum");
  });

  it("does NOT misread `export const functionList` as a function named `const`", () => {
    const r = ts("export const functionList = [];\n");
    expect(r.exports.map((e) => e.name)).not.toContain("const");
    expect(exportKinds(r).get("functionList")).toBe("const");
  });

  it("handles `export { a as renamed }` re-exports", () => {
    const r = ts("const a = 1;\nexport { a as renamed };\n");
    expect(r.exports.find((e) => e.name === "renamed")).toBeTruthy();
  });

  it("lists an exported abstract class with an `abstract` signature", () => {
    const r = ts("export abstract class Shape { area(): number { return 0; } }\n");
    expect(exportKinds(r).get("Shape")).toBe("class");
    const cls = r.symbols.find((s) => s.name === "Shape" && s.kind === "class")!;
    expect(cls.signature).toContain("abstract");
  });
});

describe("TreeSitterBackend — TS signatures + imports (anchored, not substring)", () => {
  it("captures async / generator in the real signature", () => {
    const r = ts(
      ["export async function loader() {}", "export function* gen() {}"].join("\n"),
    );
    const loader = r.symbols.find((s) => s.name === "loader")!;
    expect(loader.signature).toContain("async");
    const gen = r.symbols.find((s) => s.name === "gen")!;
    expect(gen.signature).toContain("*");
  });

  it("marks `import type` without misreading `import typeOf`", () => {
    const r = ts(
      [
        "import type { Widget } from './w';",
        "import typeOf from './t';",
        "import { plain } from './p';",
      ].join("\n"),
    );
    const byNames = (names: string[]) =>
      r.imports.find((i) => i.names.includes(names[0]))!;
    expect(byNames(["Widget"]).isTypeOnly).toBe(true);
    expect(byNames(["typeOf"]).isTypeOnly).toBe(false);
    expect(byNames(["plain"]).isTypeOnly).toBe(false);
  });
});

describe("TreeSitterBackend — TS declaration line numbers (no off-by-one)", () => {
  it("reports real lines for non-first-line decls", () => {
    const r = ts(
      [
        "const a = 1;", // 1
        "function foo() {}", // 2
        "", // 3 (blank — the regex anchor used to swallow this)
        "class Bar {}", // 4
        "interface Iface {}", // 5
      ].join("\n"),
    );
    expect(r.symbols.find((s) => s.name === "foo")!.startLine).toBe(2);
    expect(r.symbols.find((s) => s.name === "Bar")!.startLine).toBe(4);
    expect(r.symbols.find((s) => s.name === "Iface")!.startLine).toBe(5);
    // byte spans are real, not null
    const foo = r.symbols.find((s) => s.name === "foo")!;
    expect(foo.startByte).not.toBeNull();
    expect(foo.endByte! > foo.startByte!).toBe(true);
  });
});

describe("TreeSitterBackend — TS heritage relations + methods", () => {
  it("extracts extends + implements as relations and methods as child symbols", () => {
    const r = ts(
      "export class Bar extends Base implements IFace, JFace {\n  greet() { return 1; }\n}\n",
    );
    const ext = r.relations.find((x) => x.kind === "extends")!;
    expect(ext.fromQualifiedName).toBe("Bar");
    expect(ext.toName).toBe("Base");
    const impl = r.relations
      .filter((x) => x.kind === "implements")
      .map((x) => x.toName)
      .sort();
    expect(impl).toEqual(["IFace", "JFace"]);
    const greet = r.symbols.find((s) => s.name === "greet")!;
    expect(greet.kind).toBe("method");
    expect(greet.qualifiedName).toBe("Bar.greet");
    expect(greet.parentQualifiedName).toBe("Bar");
  });

  it("extracts interface extends as relations", () => {
    const r = ts("interface I extends A, B { n: number }\n");
    const targets = r.relations
      .filter((x) => x.kind === "extends" && x.fromQualifiedName === "I")
      .map((x) => x.toName)
      .sort();
    expect(targets).toEqual(["A", "B"]);
  });
});

describe("TreeSitterBackend — Python", () => {
  it("captures imports, async defs, private vs exported", () => {
    const r = py(
      [
        "from os import path, sep",
        "import sys",
        "async def fetch(url): return url",
        "def _private(): pass",
      ].join("\n"),
    );
    const importedNames = r.imports.flatMap((i) => i.names).sort();
    expect(importedNames).toEqual(["path", "sep", "sys"].sort());
    const fetch = r.symbols.find((s) => s.name === "fetch")!;
    expect(fetch.signature).toContain("async");
    expect(exportKinds(r).get("fetch")).toBe("function");
    // leading-underscore defs are not exported
    expect(r.exports.find((e) => e.name === "_private")).toBeUndefined();
  });

  it("reports real lines, anchors decorated defs at the decorator, extracts bases", () => {
    const r = py(
      [
        "import os", // 1
        "", // 2
        "def foo():", // 3
        "    return 1", // 4
        "", // 5
        "@decorator", // 6
        "def bar():", // 7
        "    return 2", // 8
        "", // 9
        "class Baz(Base, Mixin):", // 10
        "    def meth(self): pass", // 11
      ].join("\n"),
    );
    expect(r.symbols.find((s) => s.name === "foo")!.startLine).toBe(3);
    expect(r.symbols.find((s) => s.name === "Baz")!.startLine).toBe(10);
    // decorated def anchored at its decorator line so extraction keeps it
    expect(r.symbols.find((s) => s.name === "bar")!.startLine).toBe(6);
    const bases = r.relations
      .filter((x) => x.fromQualifiedName === "Baz" && x.kind === "extends")
      .map((x) => x.toName)
      .sort();
    expect(bases).toEqual(["Base", "Mixin"]);
    const meth = r.symbols.find((s) => s.name === "meth")!;
    expect(meth.qualifiedName).toBe("Baz.meth");
  });
});

describe("TreeSitterBackend — end-to-end through the indexing service", () => {
  let projectDir: string;

  afterEach(() => {
    if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("indexes a project with extracted-tier symbols + resolved heritage", () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-ts-e2e-"));
    fs.writeFileSync(
      path.join(projectDir, "base.ts"),
      "export class Base {}\n",
    );
    fs.writeFileSync(
      path.join(projectDir, "child.ts"),
      "import { Base } from './base';\nexport class Child extends Base {\n  run() {}\n}\n",
    );

    // defaultBackends() resolves the warmed tree-sitter backend ahead of regex.
    const result = ensureProjectIndexed(projectDir, { force: true });
    expect(result).not.toBeNull();

    const cm = openCodeMap(projectDir)!;
    try {
      const pid = projectIdFor(projectDir);
      const child = cm.getSymbolsByName(pid, "Child")[0];
      expect(child).toBeTruthy();
      // The defining mark of the tree-sitter tier, not regex's "inferred".
      expect(child.confidence).toBe("extracted");
      const run = cm.getSymbolsByName(pid, "run")[0];
      expect(run.confidence).toBe("extracted");
    } finally {
      cm.close();
    }
  });
});
