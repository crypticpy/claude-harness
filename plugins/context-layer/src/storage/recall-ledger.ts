/**
 * Memory-recall ledger (MCP-server runtime)
 *
 * TS twin of recordMemoryRecall in hooks/unified/modules/event-writer.mjs:
 * ONE 'memory_recall' event per recall batch (meta.ids = the recalled memory
 * ids), appended to the same events.jsonl the hook runtime writes. Feeds the
 * never-recalled prune in precompact-reducer — without this, memories surfaced
 * only via brain_search / puntax_context looked "never recalled" and could be
 * pruned while in active use.
 *
 * Only ids from the typed memory store (mem_*) are recorded; convention names
 * and other non-store ids that flow through the same candidate pipeline are
 * dropped. Ledger gating (config.eventLedger.enabled) lives here so both
 * recall tools share one choke point. Fail-open: telemetry must never break a
 * read-only recall tool.
 */

import { appendFileSync } from "fs";
import { createHash } from "crypto";
import { contextPaths, ensureDir } from "./paths";
import { loadPuntaxConfig } from "../config/puntax-config";

// Per-process monotonic counter so two same-content events get distinct ids
// (mirrors event-writer.mjs).
let seq = 0;

export function recordMemoryRecall(
  projectDir: string | undefined,
  ids: Array<string | undefined>,
  opts: { via?: string; sessionId?: string } = {},
): boolean {
  try {
    if (!projectDir) return false;
    const list = [
      ...new Set(
        ids.filter(
          (i): i is string => typeof i === "string" && i.startsWith("mem_"),
        ),
      ),
    ];
    if (!list.length) return false;
    if (!loadPuntaxConfig().eventLedger.enabled) return false;

    const sessionId = opts.sessionId || "unknown";
    const ts = new Date().toISOString();
    const core = {
      sessionId,
      ts,
      kind: "memory_recall",
      tool: null,
      files: [],
      symbols: [],
      command: null,
      outcome: "ok",
      seq: seq++,
    };
    const event = {
      id: `evt_${createHash("sha1").update(JSON.stringify(core)).digest("hex").slice(0, 20)}`,
      sessionId,
      ts,
      kind: "memory_recall",
      tool: null,
      projectDir,
      files: [],
      symbols: [],
      command: null,
      outcome: "ok",
      summary: `recalled ${list.length} typed memor${list.length === 1 ? "y" : "ies"}${opts.via ? " via " + opts.via : ""}`,
      risk: null,
      meta: { ids: list, via: opts.via || null },
    };

    const paths = contextPaths(projectDir);
    ensureDir(paths.dir);
    appendFileSync(paths.events, JSON.stringify(event) + "\n");
    return true;
  } catch {
    return false;
  }
}
