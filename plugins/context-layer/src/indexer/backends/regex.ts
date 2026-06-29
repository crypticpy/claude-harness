/**
 * Regex backend (Tier 3 — fallback).
 *
 * Wraps the existing regex `parseFile` (indexer/parser.ts) and adapts its
 * ParseResult into the backend's BackendParseResult. Always available; used when
 * no higher-tier backend (Tree-sitter / LSP) can handle a language. Symbols are
 * tagged `inferred` because spans/line precision are heuristic.
 */

import { parseFile } from "../parser";
import type { FunctionInfo, ClassInfo, TypeInfo, ImportInfo } from "../types";
import type {
  IndexBackend,
  BackendParseResult,
  ExtractedSymbol,
  ExtractedImport,
  ExtractedRelation,
} from "./types";

const SUPPORTED = new Set(["typescript", "python"]);

export class RegexBackend implements IndexBackend {
  readonly name = "regex";
  readonly tier = "inferred" as const;

  isAvailable(): boolean {
    return true;
  }

  supports(language: string): boolean {
    return SUPPORTED.has(language);
  }

  parse(content: string, filePath: string): BackendParseResult {
    const parsed = parseFile(content, filePath, {
      extractDocstrings: true,
      extractDecorators: true,
    });

    const symbols: ExtractedSymbol[] = [];
    const relations: ExtractedRelation[] = [];

    for (const fn of parsed.functions) {
      symbols.push(funcSymbol(fn));
    }

    for (const cls of parsed.classes) {
      symbols.push(classSymbol(cls));
      // Class methods as child symbols (line precision is the class line —
      // regex does not track per-method spans; tree-sitter will refine).
      for (const method of cls.methods) {
        symbols.push({
          kind: "method",
          name: method,
          qualifiedName: `${cls.name}.${method}`,
          parentQualifiedName: cls.name,
          startLine: cls.line,
          endLine: cls.line,
          startByte: null,
          endByte: null,
          signature: `${cls.name}.${method}()`,
          doc: null,
          confidence: "inferred",
        });
      }
      if (cls.extends) {
        relations.push({
          fromQualifiedName: cls.name,
          toName: cls.extends,
          kind: "extends",
          line: cls.line,
        });
      }
      for (const impl of cls.implements ?? []) {
        relations.push({
          fromQualifiedName: cls.name,
          toName: impl,
          kind: "implements",
          line: cls.line,
        });
      }
    }

    for (const t of parsed.types) {
      symbols.push(typeSymbol(t));
      for (const ext of t.extends ?? []) {
        relations.push({
          fromQualifiedName: t.name,
          toName: ext,
          kind: "extends",
          line: t.line,
        });
      }
    }

    return {
      language: parsed.language,
      lineCount: parsed.lineCount,
      symbols,
      imports: groupImports(parsed.imports),
      exports: parsed.exports.map((e) => ({
        name: e.name,
        kind: e.kind,
        line: e.line,
      })),
      relations,
      errors: parsed.errors,
    };
  }
}

function funcSymbol(fn: FunctionInfo): ExtractedSymbol {
  const prefix = `${fn.isAsync ? "async " : ""}${fn.isGenerator ? "*" : ""}`;
  const ret = fn.returnType ? `: ${fn.returnType}` : "";
  return {
    kind: "function",
    name: fn.name,
    qualifiedName: fn.name,
    parentQualifiedName: null,
    startLine: fn.line,
    endLine: fn.line,
    startByte: null,
    endByte: null,
    signature: `${prefix}${fn.name}(${fn.params.join(", ")})${ret}`,
    doc: fn.docstring ?? null,
    confidence: "inferred",
  };
}

function classSymbol(cls: ClassInfo): ExtractedSymbol {
  const ext = cls.extends ? ` extends ${cls.extends}` : "";
  const impl =
    cls.implements && cls.implements.length
      ? ` implements ${cls.implements.join(", ")}`
      : "";
  return {
    kind: "class",
    name: cls.name,
    qualifiedName: cls.name,
    parentQualifiedName: null,
    startLine: cls.line,
    endLine: cls.line,
    startByte: null,
    endByte: null,
    signature: `${cls.isAbstract ? "abstract " : ""}class ${cls.name}${ext}${impl}`,
    doc: null,
    confidence: "inferred",
  };
}

function typeSymbol(t: TypeInfo): ExtractedSymbol {
  const ext =
    t.extends && t.extends.length ? ` extends ${t.extends.join(", ")}` : "";
  return {
    kind: t.kind,
    name: t.name,
    qualifiedName: t.name,
    parentQualifiedName: null,
    startLine: t.line,
    endLine: t.line,
    startByte: null,
    endByte: null,
    signature: `${t.kind} ${t.name}${ext}`,
    doc: null,
    confidence: "inferred",
  };
}

/** Collapse per-name ImportInfo rows into one ExtractedImport per (source,line). */
function groupImports(imports: ImportInfo[]): ExtractedImport[] {
  const byKey = new Map<string, ExtractedImport>();
  for (const imp of imports) {
    const key = `${imp.source}::${imp.line}`;
    const existing = byKey.get(key);
    if (existing) {
      if (imp.name) existing.names.push(imp.name);
      existing.isTypeOnly = existing.isTypeOnly && imp.isTypeOnly;
    } else {
      byKey.set(key, {
        source: imp.source,
        names: imp.name ? [imp.name] : [],
        line: imp.line,
        isTypeOnly: imp.isTypeOnly,
      });
    }
  }
  return [...byKey.values()];
}
