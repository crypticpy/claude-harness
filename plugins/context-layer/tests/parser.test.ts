import { describe, it, expect } from "vitest";
import { parseFile } from "../src/indexer/parser";

const ts = (src: string) => parseFile(src, "mod.ts");
const py = (src: string) => parseFile(src, "mod.py");

describe("parseFile — TS export classification (common case preserved)", () => {
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
    const byName = new Map(r.exports.map((e) => [e.name, e.kind]));
    expect(byName.get("foo")).toBe("function");
    expect(byName.get("Bar")).toBe("class");
    expect(byName.get("baz")).toBe("const");
    expect(byName.get("Iface")).toBe("interface");
    expect(byName.get("Alias")).toBe("type");
    expect(byName.get("Color")).toBe("enum");
  });

  it("marks type-only imports without misreading `import typeOf`", () => {
    const r = ts(
      [
        "import type { Widget } from './w';",
        "import typeOf from './t';",
        "import { plain } from './p';",
      ].join("\n"),
    );
    const widget = r.imports.find((i) => i.name === "Widget")!;
    expect(widget.isTypeOnly).toBe(true);
    // `typeOf` is a default import; the substring "import type" must not flip it.
    expect(r.imports.find((i) => i.name === "typeOf")!.isTypeOnly).toBe(false);
    expect(r.imports.find((i) => i.name === "plain")!.isTypeOnly).toBe(false);
  });

  it("handles named re-export braces", () => {
    const r = ts("const a = 1;\nexport { a as renamed };\n");
    const exp = r.exports.find((e) => e.name === "renamed");
    expect(exp).toBeTruthy();
    expect(exp!.originalName).toBe("a");
  });
});

describe("parseFile — TS export keyword sniffing bug (fixed)", () => {
  it("does NOT misread `export const functionList` as a function export", () => {
    const r = ts("export const functionList = [];\n");
    // Was: {name: 'const', kind: 'function'}. Now the real name + kind.
    expect(r.exports.map((e) => e.name)).not.toContain("const");
    const exp = r.exports.find((e) => e.name === "functionList");
    expect(exp).toBeTruthy();
    expect(exp!.kind).toBe("const");
  });

  it("does NOT misread `export const classFactory` as a class export", () => {
    const r = ts("export const classFactory = null;\n");
    expect(r.exports.map((e) => e.name)).not.toContain("const");
    expect(r.exports.find((e) => e.name === "classFactory")?.kind).toBe(
      "const",
    );
  });
});

describe("parseFile — TS function/class metadata flags (anchored, not substring)", () => {
  it("keeps real export/async/generator flags", () => {
    const r = ts(
      [
        "export async function loader() {}",
        "export function* gen() {}",
      ].join("\n"),
    );
    const loader = r.functions.find((f) => f.name === "loader")!;
    expect(loader.isExported).toBe(true);
    expect(loader.isAsync).toBe(true);
    const gen = r.functions.find((f) => f.name === "gen")!;
    expect(gen.isGenerator).toBe(true);
  });

  it("does not flag a non-exported `exportData` / non-async `asyncHandler`", () => {
    const r = ts("function exportData() {}\nfunction asyncHandler() {}\n");
    expect(r.functions.find((f) => f.name === "exportData")!.isExported).toBe(
      false,
    );
    expect(r.functions.find((f) => f.name === "asyncHandler")!.isAsync).toBe(
      false,
    );
  });

  it("does not treat a `*` inside a default param as a generator", () => {
    const r = ts("function calc(n = 4 * 2) { return n; }\n");
    expect(r.functions.find((f) => f.name === "calc")!.isGenerator).toBe(false);
  });

  it("distinguishes a real abstract class from a class named `abstractFactory`", () => {
    const r = ts("abstract class Base {}\nclass abstractFactory {}\n");
    expect(r.classes.find((c) => c.name === "Base")!.isAbstract).toBe(true);
    expect(
      r.classes.find((c) => c.name === "abstractFactory")!.isAbstract,
    ).toBe(false);
  });

  it("does not flag a non-exported type named `exportType`", () => {
    const r = ts("type exportType = string;\n");
    expect(r.types.find((t) => t.name === "exportType")!.isExported).toBe(false);
  });
});

describe("parseFile — Python imports + defs still parse", () => {
  it("captures from-imports, plain imports, and defs", () => {
    const r = py(
      [
        "from os import path, sep",
        "import sys",
        "async def fetch(url): pass",
        "def _private(): pass",
      ].join("\n"),
    );
    expect(r.imports.map((i) => i.name).sort()).toEqual(
      ["path", "sep", "sys"].sort(),
    );
    const fetch = r.functions.find((f) => f.name === "fetch")!;
    expect(fetch.isAsync).toBe(true);
    expect(fetch.isExported).toBe(true);
    expect(r.functions.find((f) => f.name === "_private")!.isExported).toBe(
      false,
    );
  });
});
