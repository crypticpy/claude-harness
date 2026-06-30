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
});
