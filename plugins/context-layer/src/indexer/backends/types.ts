/**
 * Code-map backend abstraction.
 *
 * A backend extracts structure from ONE file's content. The indexer
 * (code-indexer.ts) turns that structure into code-map rows and resolves
 * cross-file edges in a post-pass. Backends are pure per-file and stateless.
 *
 * Tiers (high -> low), per docs/06:
 *   lsp        LSP-derived, high confidence
 *   extracted  Tree-sitter syntactic extraction
 *   inferred   regex / heuristic fallback
 *
 * NB: `lsp` is a QUERY-TIME tier (symbol_context / impact_check call a language
 * server on demand) — there is no LSP `IndexBackend`, because `parse()` is
 * synchronous and LSP is inherently async. The bulk indexer therefore runs only
 * two backends, in order: tree-sitter (`extracted`) then regex (`inferred`) as
 * the always-available fallback — see `defaultBackends()` in code-map-service.
 * Config `codeMap.backendOrder` is documentation only; nothing reads it for
 * selection (`pickBackend` honors the array order it is handed).
 */

import type { Confidence } from "../../storage/code-map";

export interface ExtractedSymbol {
  kind: string;
  name: string;
  qualifiedName: string;
  /** Qualified name of the enclosing symbol (e.g. a class for a method). */
  parentQualifiedName: string | null;
  startLine: number;
  endLine: number;
  startByte: number | null;
  endByte: number | null;
  signature: string | null;
  doc: string | null;
  confidence: Confidence;
}

export interface ExtractedImport {
  /** Raw module specifier as written, e.g. './foo' or 'react'. */
  source: string;
  /** Imported binding names (best effort). */
  names: string[];
  line: number;
  isTypeOnly: boolean;
}

export interface ExtractedExport {
  name: string;
  kind: string;
  line: number;
}

/** A name-based structural relation the post-pass resolves to a target symbol. */
export interface ExtractedRelation {
  /** Qualified name of the source symbol (must appear in `symbols`). */
  fromQualifiedName: string;
  /** Bare name of the referenced target (resolved against the project). */
  toName: string;
  kind: "extends" | "implements";
  line: number;
}

export interface BackendParseResult {
  language: string;
  lineCount: number;
  symbols: ExtractedSymbol[];
  imports: ExtractedImport[];
  exports: ExtractedExport[];
  relations: ExtractedRelation[];
  errors: string[];
}

export interface IndexBackend {
  /** Stable identifier: 'regex' | 'tree-sitter' | 'lsp'. */
  readonly name: string;
  /** Confidence tier this backend's symbols are tagged with. */
  readonly tier: Confidence;
  /** Whether the backend can run in the current environment. */
  isAvailable(): boolean;
  /** Whether the backend can parse the given language id. */
  supports(language: string): boolean;
  /** Extract structure from one file. Must not throw — return errors instead. */
  parse(content: string, filePath: string): BackendParseResult;
}
