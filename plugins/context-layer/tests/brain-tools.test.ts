import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { brainSearch } from "../src/tools/brain-tools";

let projectDir: string;
let brainDir: string;

function writeBrain(file: string, content: string): void {
  fs.writeFileSync(path.join(brainDir, file), content);
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-tools-"));
  brainDir = path.join(projectDir, ".claude", "context-layer");
  fs.mkdirSync(brainDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("brainSearch — typed memories source", () => {
  it("surfaces a matching active typed memory", async () => {
    writeBrain(
      "memories.jsonl",
      JSON.stringify({
        id: "mem_a",
        kind: "gotcha",
        text: "the personality hook reads a global stats file across sessions",
        severity: "high",
        status: "active",
      }),
    );

    const out = await brainSearch({
      query: "personality hook stats",
      projectPath: projectDir,
    });

    const mem = out.results.find((r) => r.source === "memory");
    expect(mem).toBeDefined();
    expect(mem!.context).toContain("[gotcha/high]");
    expect(mem!.context).toContain("global stats file");
  });

  it("skips a corrupt lessons line without dropping the surrounding lessons", async () => {
    // A crash mid-append can leave one malformed JSONL line. The other lessons
    // must still be recallable — not silently zeroed by the one bad row.
    writeBrain(
      "lessons.jsonl",
      [
        JSON.stringify({
          type: "bug",
          lesson: "the formatter mangles CRLF newlines on write",
          severity: "high",
          files: [],
        }),
        "{ this is not valid json",
        JSON.stringify({
          type: "bug",
          lesson: "the formatter also drops a trailing newline",
          severity: "medium",
          files: [],
        }),
      ].join("\n"),
    );

    const out = await brainSearch({
      query: "formatter newline",
      projectPath: projectDir,
      sources: ["lessons"],
    });
    const lessons = out.results.filter((r) => r.source === "lesson");
    expect(lessons).toHaveLength(2);
    expect(lessons.some((l) => l.match.includes("CRLF"))).toBe(true);
    expect(lessons.some((l) => l.match.includes("trailing newline"))).toBe(true);
  });

  it("skips archived memories and respects an explicit sources filter", async () => {
    writeBrain(
      "memories.jsonl",
      [
        JSON.stringify({
          id: "mem_active",
          kind: "decision",
          text: "auth tokens refresh on the active path",
          status: "active",
        }),
        JSON.stringify({
          id: "mem_archived",
          kind: "decision",
          text: "auth tokens refresh on the archived path",
          status: "archived",
        }),
      ].join("\n"),
    );

    const all = await brainSearch({
      query: "auth tokens",
      projectPath: projectDir,
    });
    expect(all.results.some((r) => r.context.includes("active path"))).toBe(
      true,
    );
    expect(all.results.some((r) => r.context.includes("archived path"))).toBe(
      false,
    );

    // Restricting to lessons must exclude the memories source entirely.
    const lessonsOnly = await brainSearch({
      query: "auth tokens",
      projectPath: projectDir,
      sources: ["lessons"],
    });
    expect(lessonsOnly.results.some((r) => r.source === "memory")).toBe(false);
  });

  it("excludes expired and malformed-expiry memories from recall", async () => {
    // Recall must match the store's "active, non-expired" contract: an expired
    // row, and a row whose expiresAt is present-but-unparseable (Date.parse ->
    // NaN), must both be hidden — not leaked until the next prune sweep.
    writeBrain(
      "memories.jsonl",
      [
        JSON.stringify({
          id: "mem_live",
          kind: "decision",
          text: "cache layer uses the fresh path",
          status: "active",
          expiresAt: "2099-01-01T00:00:00Z", // far future -> kept
        }),
        JSON.stringify({
          id: "mem_expired",
          kind: "decision",
          text: "cache layer once used the stale path",
          status: "active",
          expiresAt: "2020-01-01T00:00:00Z", // past -> excluded
        }),
        JSON.stringify({
          id: "mem_garbage",
          kind: "decision",
          text: "cache layer briefly used the corrupt path",
          status: "active",
          expiresAt: "not-a-date", // NaN -> excluded (fail-safe)
        }),
      ].join("\n"),
    );

    const out = await brainSearch({
      query: "cache layer path",
      projectPath: projectDir,
    });
    expect(out.results.some((r) => r.context.includes("fresh path"))).toBe(true);
    expect(out.results.some((r) => r.context.includes("stale path"))).toBe(false);
    expect(out.results.some((r) => r.context.includes("corrupt path"))).toBe(
      false,
    );
  });
});
