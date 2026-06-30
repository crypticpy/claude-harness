/**
 * Tree-sitter backend (Tier 2 — extracted).
 *
 * Byte-precise syntactic extraction via web-tree-sitter (WASM grammars; no
 * native toolchain). Grammars load once at process start (warmTreeSitter, called
 * from the MCP server's boot); parse() is then fully SYNCHRONOUS against the
 * pre-loaded grammars, satisfying the synchronous IndexBackend.parse contract.
 *
 * This is the tier the config (`codeMap.backendOrder`) and IndexBackend id
 * always named but no file implemented — so every TS/Python file fell through to
 * RegexBackend. It replaces the regex parser's keyword-substring classification
 * and off-by-one line bugs at the root: names, spans, and class/interface
 * heritage come from the real AST.
 *
 * Fail-open: if the runtime or a grammar can't load, create()/warm yields null
 * and the indexer keeps using RegexBackend.
 */

import * as fs from "fs";
import * as path from "path";
import Parser from "web-tree-sitter";

import { getLanguageFromExtension } from "../parser";
import type {
  IndexBackend,
  BackendParseResult,
  ExtractedSymbol,
  ExtractedImport,
  ExtractedExport,
  ExtractedRelation,
} from "./types";

type Node = Parser.SyntaxNode;

/** Grammar key -> tree-sitter-wasms grammar file stem. */
const GRAMMARS: Record<string, string> = {
  typescript: "tree-sitter-typescript",
  tsx: "tree-sitter-tsx",
  python: "tree-sitter-python",
};

const SIG_MAX = 240;
const MAX_SYNTAX_ERRORS = 50;

export interface SyntaxIssue {
  kind: "error" | "missing";
  /** The tree-sitter node type at the defect (e.g. "ERROR", ")", "}"). */
  detail: string;
  line: number;
  column: number;
}

export interface SyntaxCheckResult {
  language: string;
  /** False when no grammar covers the language — the check is a no-op then. */
  supported: boolean;
  ok: boolean;
  errorCount: number;
  errors: SyntaxIssue[];
}

// ---------------------------------------------------------------------------
// backend
// ---------------------------------------------------------------------------

export class TreeSitterBackend implements IndexBackend {
  readonly name = "tree-sitter";
  readonly tier = "extracted" as const;

  private constructor(
    private readonly parser: Parser,
    private readonly languages: Map<string, Parser.Language>,
  ) {}

  /** Initialize the WASM runtime and load grammars. Throws on any failure. */
  static async create(): Promise<TreeSitterBackend> {
    const nodeModules = findNodeModulesBase();
    if (!nodeModules) throw new Error("tree-sitter: node_modules not found");

    await Parser.init({
      locateFile: (name: string) =>
        path.join(nodeModules, "web-tree-sitter", name),
    });

    const languages = new Map<string, Parser.Language>();
    for (const [key, stem] of Object.entries(GRAMMARS)) {
      const wasmPath = path.join(
        nodeModules,
        "tree-sitter-wasms",
        "out",
        `${stem}.wasm`,
      );
      languages.set(key, await Parser.Language.load(wasmPath));
    }
    return new TreeSitterBackend(new Parser(), languages);
  }

  isAvailable(): boolean {
    return this.languages.size > 0;
  }

  supports(language: string): boolean {
    return language === "typescript" || language === "python";
  }

  /**
   * Pick the loaded grammar for a file, or undefined when no grammar covers the
   * language (tsx/jsx use the JSX-aware grammar). Only the languages `supports()`
   * accepts resolve — anything else returns undefined so `checkSyntax` reports a
   * no-op instead of mis-parsing (e.g. Ruby) as TypeScript.
   */
  private grammarFor(
    language: string,
    filePath: string,
  ): Parser.Language | undefined {
    if (language === "python") return this.languages.get("python");
    if (language === "typescript") {
      return /\.(tsx|jsx)$/.test(filePath)
        ? this.languages.get("tsx")
        : this.languages.get("typescript");
    }
    return undefined;
  }

  /**
   * Syntax-validity gate: parse and report ERROR / MISSING nodes. Works for any
   * loaded grammar. `supported: false` means no grammar covers the file — the
   * caller treats that as "can't check", not "invalid". Never throws.
   */
  checkSyntax(content: string, filePath: string): SyntaxCheckResult {
    const language = getLanguageFromExtension(
      path.extname(filePath).toLowerCase(),
    );
    const grammar = this.grammarFor(language, filePath);
    if (!grammar) {
      return { language, supported: false, ok: true, errorCount: 0, errors: [] };
    }
    let tree: Parser.Tree | null = null;
    try {
      this.parser.setLanguage(grammar);
      tree = this.parser.parse(content);
      const root = tree.rootNode;
      const errors: SyntaxIssue[] = [];
      if (root.hasError) {
        const stack: Node[] = [root];
        while (stack.length > 0 && errors.length < MAX_SYNTAX_ERRORS) {
          const n = stack.pop()!;
          if (n.isError || n.isMissing) {
            errors.push({
              kind: n.isMissing ? "missing" : "error",
              detail: n.type,
              line: n.startPosition.row + 1,
              column: n.startPosition.column,
            });
          }
          for (let i = n.childCount - 1; i >= 0; i--) {
            const c = n.child(i);
            if (c) stack.push(c);
          }
        }
      }
      return {
        language,
        supported: true,
        ok: !root.hasError,
        errorCount: errors.length,
        errors,
      };
    } catch {
      // Can't determine — fail-open (don't report false syntax errors).
      return { language, supported: true, ok: true, errorCount: 0, errors: [] };
    } finally {
      (tree as { delete?: () => void } | null)?.delete?.();
    }
  }

  parse(content: string, filePath: string): BackendParseResult {
    const language = getLanguageFromExtension(
      path.extname(filePath).toLowerCase(),
    );
    const empty: BackendParseResult = {
      language,
      lineCount: lineCount(content),
      symbols: [],
      imports: [],
      exports: [],
      relations: [],
      errors: [],
    };

    const grammar = this.grammarFor(language, filePath);
    if (!grammar) return { ...empty, errors: ["tree-sitter: no grammar"] };

    let tree: Parser.Tree | null = null;
    try {
      this.parser.setLanguage(grammar);
      tree = this.parser.parse(content);
      const root = tree.rootNode;

      const symbols: ExtractedSymbol[] = [];
      const imports: ExtractedImport[] = [];
      const exports: ExtractedExport[] = [];
      const relations: ExtractedRelation[] = [];

      if (language === "python") {
        extractPython(root, content, symbols, imports, exports, relations);
      } else {
        extractTypeScript(root, content, symbols, imports, exports, relations);
      }

      return {
        language,
        lineCount: lineCount(content),
        symbols,
        imports,
        exports,
        relations,
        errors: root.hasError ? ["tree-sitter: syntax errors present"] : [],
      };
    } catch (err) {
      return { ...empty, errors: [`tree-sitter: ${String(err)}`] };
    } finally {
      // Trees hold WASM memory; free it in this long-lived process.
      (tree as { delete?: () => void } | null)?.delete?.();
    }
  }
}

// ---------------------------------------------------------------------------
// warm singleton — loaded once at server boot, used synchronously thereafter
// ---------------------------------------------------------------------------

let warmPromise: Promise<TreeSitterBackend | null> | null = null;
let ready: TreeSitterBackend | null = null;

/** Idempotently initialize the backend. Resolves to null on failure (fail-open). */
export function warmTreeSitter(): Promise<TreeSitterBackend | null> {
  if (!warmPromise) {
    warmPromise = TreeSitterBackend.create()
      .then((b) => {
        ready = b;
        return b;
      })
      .catch(() => {
        ready = null;
        return null;
      });
  }
  return warmPromise;
}

/** The warmed backend, or null if warm hasn't completed / failed. */
export function readyTreeSitterBackend(): TreeSitterBackend | null {
  return ready;
}

// ---------------------------------------------------------------------------
// TypeScript extraction
// ---------------------------------------------------------------------------

function extractTypeScript(
  root: Node,
  content: string,
  symbols: ExtractedSymbol[],
  imports: ExtractedImport[],
  exports: ExtractedExport[],
  relations: ExtractedRelation[],
): void {
  for (const child of namedChildren(root)) {
    if (child.type === "import_statement") {
      imports.push(tsImport(child));
    } else if (child.type === "export_statement") {
      const decl = child.childForFieldName("declaration");
      if (decl) {
        handleTsDecl(decl, content, symbols, relations, exports);
      } else {
        for (const clause of childrenOfType(child, "export_clause")) {
          for (const spec of childrenOfType(clause, "export_specifier")) {
            const n =
              spec.childForFieldName("alias") ?? spec.childForFieldName("name");
            if (n) exports.push({ name: n.text, kind: "named", line: lineOf(child) });
          }
        }
      }
    } else {
      handleTsDecl(child, content, symbols, relations, null);
    }
  }
}

/** Process one declaration node; push to exports when `exports` is non-null. */
function handleTsDecl(
  decl: Node,
  content: string,
  symbols: ExtractedSymbol[],
  relations: ExtractedRelation[],
  exports: ExtractedExport[] | null,
): void {
  const line = lineOf(decl);
  switch (decl.type) {
    case "function_declaration":
    case "generator_function_declaration": {
      addFunction(decl, content, null, symbols);
      pushNamedExport(decl, "function", line, exports);
      break;
    }
    case "class_declaration":
    case "abstract_class_declaration": {
      addClass(decl, content, symbols, relations);
      pushNamedExport(decl, "class", line, exports);
      break;
    }
    case "interface_declaration": {
      addInterface(decl, content, symbols, relations);
      pushNamedExport(decl, "interface", line, exports);
      break;
    }
    case "type_alias_declaration": {
      addSimple(decl, content, "type", symbols);
      pushNamedExport(decl, "type", line, exports);
      break;
    }
    case "enum_declaration": {
      addSimple(decl, content, "enum", symbols);
      pushNamedExport(decl, "enum", line, exports);
      break;
    }
    case "lexical_declaration":
    case "variable_declaration": {
      addLexical(decl, content, symbols, exports);
      break;
    }
    default:
      break;
  }
}

function pushNamedExport(
  decl: Node,
  kind: string,
  line: number,
  exports: ExtractedExport[] | null,
): void {
  if (!exports) return;
  const n = decl.childForFieldName("name");
  if (n) exports.push({ name: n.text, kind, line });
}

function addFunction(
  node: Node,
  content: string,
  parentClass: string | null,
  symbols: ExtractedSymbol[],
): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const name = nameNode.text;
  symbols.push({
    kind: parentClass ? "method" : "function",
    name,
    qualifiedName: parentClass ? `${parentClass}.${name}` : name,
    parentQualifiedName: parentClass,
    startLine: lineOf(node),
    endLine: endLineOf(node),
    startByte: node.startIndex,
    endByte: node.endIndex,
    signature: signatureOf(node, content),
    doc: null,
    confidence: "extracted",
  });
}

function addClass(
  node: Node,
  content: string,
  symbols: ExtractedSymbol[],
  relations: ExtractedRelation[],
): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const name = nameNode.text;
  symbols.push({
    kind: "class",
    name,
    qualifiedName: name,
    parentQualifiedName: null,
    startLine: lineOf(node),
    endLine: endLineOf(node),
    startByte: node.startIndex,
    endByte: node.endIndex,
    signature: signatureOf(node, content),
    doc: null,
    confidence: "extracted",
  });

  const heritage = childrenOfType(node, "class_heritage")[0];
  if (heritage) {
    const ext = childrenOfType(heritage, "extends_clause")[0];
    if (ext) {
      const v = ext.childForFieldName("value") ?? namedChildren(ext)[0];
      if (v)
        relations.push({
          fromQualifiedName: name,
          toName: bareName(v.text),
          kind: "extends",
          line: lineOf(node),
        });
    }
    const impl = childrenOfType(heritage, "implements_clause")[0];
    if (impl) {
      for (const t of namedChildren(impl)) {
        relations.push({
          fromQualifiedName: name,
          toName: bareName(t.text),
          kind: "implements",
          line: lineOf(node),
        });
      }
    }
  }

  const body = node.childForFieldName("body");
  if (body) {
    for (const m of childrenOfType(body, "method_definition")) {
      addFunction(m, content, name, symbols);
    }
  }
}

function addInterface(
  node: Node,
  content: string,
  symbols: ExtractedSymbol[],
  relations: ExtractedRelation[],
): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const name = nameNode.text;
  symbols.push({
    kind: "interface",
    name,
    qualifiedName: name,
    parentQualifiedName: null,
    startLine: lineOf(node),
    endLine: endLineOf(node),
    startByte: node.startIndex,
    endByte: node.endIndex,
    signature: signatureOf(node, content),
    doc: null,
    confidence: "extracted",
  });
  const clause = childrenOfType(node, "extends_type_clause")[0];
  if (clause) {
    for (const t of fieldChildren(clause, "type")) {
      relations.push({
        fromQualifiedName: name,
        toName: bareName(t.text),
        kind: "extends",
        line: lineOf(node),
      });
    }
  }
}

/** type-alias / enum: a named, span-bearing symbol with no heritage. */
function addSimple(
  node: Node,
  content: string,
  kind: string,
  symbols: ExtractedSymbol[],
): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  symbols.push({
    kind,
    name: nameNode.text,
    qualifiedName: nameNode.text,
    parentQualifiedName: null,
    startLine: lineOf(node),
    endLine: endLineOf(node),
    startByte: node.startIndex,
    endByte: node.endIndex,
    signature: signatureOf(node, content),
    doc: null,
    confidence: "extracted",
  });
}

function addLexical(
  node: Node,
  content: string,
  symbols: ExtractedSymbol[],
  exports: ExtractedExport[] | null,
): void {
  const kindWord =
    node.type === "variable_declaration"
      ? "var"
      : node.text.startsWith("let")
        ? "let"
        : "const";
  for (const d of childrenOfType(node, "variable_declarator")) {
    const nameNode = d.childForFieldName("name");
    if (!nameNode) continue;
    const name = nameNode.text;
    if (exports) exports.push({ name, kind: kindWord, line: lineOf(node) });
    const value = d.childForFieldName("value");
    if (value && isFunctionValue(value.type)) {
      symbols.push({
        kind: "function",
        name,
        qualifiedName: name,
        parentQualifiedName: null,
        startLine: lineOf(d),
        endLine: endLineOf(d),
        startByte: d.startIndex,
        endByte: d.endIndex,
        signature: clip(firstLine(d, content)),
        doc: null,
        confidence: "extracted",
      });
    }
  }
}

function isFunctionValue(type: string): boolean {
  return (
    type === "arrow_function" ||
    type === "function" ||
    type === "function_expression" ||
    type === "generator_function"
  );
}

function tsImport(node: Node): ExtractedImport {
  const sourceNode = node.childForFieldName("source");
  const source = sourceNode ? stripQuotes(sourceNode.text) : "";
  const isTypeOnly = /^import\s+type\b/.test(node.text);
  const names: string[] = [];
  const clause = childrenOfType(node, "import_clause")[0];
  if (clause) {
    for (const c of namedChildren(clause)) {
      if (c.type === "identifier") {
        names.push(c.text); // default import
      } else if (c.type === "namespace_import") {
        const id = childrenOfType(c, "identifier")[0];
        if (id) names.push(id.text);
      } else if (c.type === "named_imports") {
        for (const spec of childrenOfType(c, "import_specifier")) {
          const n = spec.childForFieldName("name");
          if (n) names.push(n.text);
        }
      }
    }
  }
  return { source, names, line: lineOf(node), isTypeOnly };
}

// ---------------------------------------------------------------------------
// Python extraction
// ---------------------------------------------------------------------------

function extractPython(
  root: Node,
  content: string,
  symbols: ExtractedSymbol[],
  imports: ExtractedImport[],
  exports: ExtractedExport[],
  relations: ExtractedRelation[],
): void {
  for (const child of namedChildren(root)) {
    switch (child.type) {
      case "import_statement": {
        for (const dn of fieldChildren(child, "name")) {
          const src = dn.text;
          imports.push({
            source: src,
            names: [src.split(".")[0]],
            line: lineOf(child),
            isTypeOnly: false,
          });
        }
        break;
      }
      case "import_from_statement": {
        const mod = child.childForFieldName("module_name");
        const names = fieldChildren(child, "name").map((n) => n.text);
        imports.push({
          source: mod ? mod.text : "",
          names,
          line: lineOf(child),
          isTypeOnly: false,
        });
        break;
      }
      case "function_definition":
        addPyFunction(child, child, content, null, symbols, exports);
        break;
      case "class_definition":
        addPyClass(child, child, content, symbols, exports, relations);
        break;
      case "decorated_definition": {
        const def = child.childForFieldName("definition");
        if (def?.type === "function_definition") {
          addPyFunction(def, child, content, null, symbols, exports);
        } else if (def?.type === "class_definition") {
          addPyClass(def, child, content, symbols, exports, relations);
        }
        break;
      }
      default:
        break;
    }
  }
}

/** `anchor` is the decorated_definition (so the symbol spans its decorators). */
function addPyFunction(
  node: Node,
  anchor: Node,
  content: string,
  parentClass: string | null,
  symbols: ExtractedSymbol[],
  exports: ExtractedExport[],
): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const name = nameNode.text;
  symbols.push({
    kind: parentClass ? "method" : "function",
    name,
    qualifiedName: parentClass ? `${parentClass}.${name}` : name,
    parentQualifiedName: parentClass,
    startLine: lineOf(anchor),
    endLine: endLineOf(anchor),
    startByte: anchor.startIndex,
    endByte: anchor.endIndex,
    signature: clip(firstLine(node, content)),
    doc: null,
    confidence: "extracted",
  });
  if (!parentClass && !name.startsWith("_")) {
    exports.push({ name, kind: "function", line: lineOf(anchor) });
  }
}

function addPyClass(
  node: Node,
  anchor: Node,
  content: string,
  symbols: ExtractedSymbol[],
  exports: ExtractedExport[],
  relations: ExtractedRelation[],
): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const name = nameNode.text;
  symbols.push({
    kind: "class",
    name,
    qualifiedName: name,
    parentQualifiedName: null,
    startLine: lineOf(anchor),
    endLine: endLineOf(anchor),
    startByte: anchor.startIndex,
    endByte: anchor.endIndex,
    signature: clip(firstLine(node, content)),
    doc: null,
    confidence: "extracted",
  });
  if (!name.startsWith("_")) {
    exports.push({ name, kind: "class", line: lineOf(anchor) });
  }

  const bases = node.childForFieldName("superclasses");
  if (bases) {
    for (const b of namedChildren(bases)) {
      if (b.type === "keyword_argument") continue; // metaclass=, etc.
      relations.push({
        fromQualifiedName: name,
        toName: bareName(b.text),
        kind: "extends",
        line: lineOf(anchor),
      });
    }
  }

  const body = node.childForFieldName("body");
  if (body) {
    for (const m of namedChildren(body)) {
      if (m.type === "function_definition") {
        addPyFunction(m, m, content, name, symbols, exports);
      } else if (m.type === "decorated_definition") {
        const def = m.childForFieldName("definition");
        if (def?.type === "function_definition") {
          addPyFunction(def, m, content, name, symbols, exports);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// node helpers
// ---------------------------------------------------------------------------

function lineOf(node: Node): number {
  return node.startPosition.row + 1;
}

function endLineOf(node: Node): number {
  return node.endPosition.row + 1;
}

function namedChildren(node: Node): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.isNamed) out.push(c);
  }
  return out;
}

function childrenOfType(node: Node, type: string): Node[] {
  return namedChildren(node).filter((c) => c.type === type);
}

function fieldChildren(node: Node, field: string): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && node.fieldNameForChild(i) === field) out.push(c);
  }
  return out;
}

/** Declaration text up to its body (or the whole node if there is no body). */
function signatureOf(node: Node, content: string): string {
  const body = node.childForFieldName("body");
  const end = body ? body.startIndex : node.endIndex;
  return clip(content.slice(node.startIndex, end).replace(/\s+/g, " ").trim());
}

function firstLine(node: Node, content: string): string {
  return content.slice(node.startIndex, node.endIndex).split("\n")[0].trim();
}

function clip(s: string): string {
  return s.length > SIG_MAX ? `${s.slice(0, SIG_MAX - 1)}…` : s;
}

/** Strip type arguments and module qualifier: `Foo.Bar<T>` -> `Bar`. */
function bareName(s: string): string {
  const noGenerics = s.replace(/<[\s\S]*$/, "");
  const seg = noGenerics.split(".").pop();
  return (seg ?? noGenerics).trim();
}

function stripQuotes(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, "");
}

function lineCount(content: string): number {
  return content.length === 0 ? 0 : content.split("\n").length;
}

// ---------------------------------------------------------------------------
// wasm resolution
// ---------------------------------------------------------------------------

/**
 * Find the node_modules dir holding web-tree-sitter by walking up from this
 * module (works for compiled dist AND the vitest source runtime), then cwd.
 * Avoids require.resolve, which is unreliable under vitest's ESM loader.
 */
function findNodeModulesBase(): string | null {
  const starts: string[] = [];
  if (typeof __dirname !== "undefined") starts.push(__dirname);
  starts.push(process.cwd());
  for (const start of starts) {
    let dir = start;
    for (let depth = 0; depth < 8; depth++) {
      const probe = path.join(
        dir,
        "node_modules",
        "web-tree-sitter",
        "tree-sitter.wasm",
      );
      if (fs.existsSync(probe)) return path.join(dir, "node_modules");
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}
