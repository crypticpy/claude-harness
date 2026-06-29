import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  lessonsToMemories,
  conventionsToMemories,
  fileInsightsToMemories,
  userPrefsToMemories,
  collectBrainMigrations,
} from "../src/storage/memory-migrate";
import { validateMemory, normalizeMemory } from "../src/storage/memory-store";

const PID = "prj_test";

describe("lessonsToMemories", () => {
  it("maps bootstrap to project_fact and classifies free-text lessons", () => {
    const rows = [
      {
        type: "bootstrap",
        lesson: "Project initialized. Stack: TS",
        severity: "low",
      },
      {
        type: "note",
        lesson: "The build failed when CRLF was normalized",
        severity: "high",
      },
      {
        type: "note",
        lesson: "Gotcha: must preserve newlines on write",
        severity: "medium",
      },
      { type: "note", lesson: "Tools live in src/tools", severity: "low" },
    ];
    const mems = lessonsToMemories(rows, PID);
    expect(mems.map((m) => m.kind)).toEqual([
      "project_fact", // bootstrap
      "failure_pattern", // "failed"
      "gotcha", // "must "
      "project_fact", // plain
    ]);
    expect(mems.every((m) => m.confidence === "imported")).toBe(true);
    expect(mems.every((m) => m.provenance.source === "migration")).toBe(true);
    expect(mems[1].severity).toBe("high");
  });

  it("expands trace-diagnosis patterns and lessons arrays", () => {
    const rows = [
      {
        type: "trace-diagnosis",
        patterns: ["Frequent context switching across files"],
        lessons: ["Session completed without significant issues"],
        improvements: ["Bundle related edits"], // intentionally ignored
        severity: "low",
      },
    ];
    const mems = lessonsToMemories(rows, PID);
    const patterns = mems.filter((m) => m.kind === "failure_pattern");
    expect(patterns).toHaveLength(1);
    expect(patterns[0].text).toMatch(/context switching/);
    // the lesson string is classified (no failure/gotcha keyword -> project_fact)
    expect(
      mems.some((m) => m.text.includes("without significant issues")),
    ).toBe(true);
  });

  it("ignores non-object rows", () => {
    expect(lessonsToMemories([null, 42, "x"], PID)).toEqual([]);
  });
});

describe("conventionsToMemories", () => {
  it("emits one convention per pattern / naming entry", () => {
    const data = {
      patterns: { imports: "use absolute paths" },
      namingConventions: { files: "kebab-case" },
    };
    const mems = conventionsToMemories(data, PID);
    expect(mems).toHaveLength(2);
    expect(mems.every((m) => m.kind === "convention")).toBe(true);
    expect(mems[0].text).toBe("imports: use absolute paths");
  });

  it("returns nothing for empty conventions", () => {
    expect(
      conventionsToMemories({ patterns: {}, namingConventions: {} }, PID),
    ).toEqual([]);
  });
});

describe("fileInsightsToMemories", () => {
  it("maps insights to file-scoped project_fact with risk severity", () => {
    const data = {
      insights: {
        "package.json": {
          role: "Node.js dependencies",
          risk: "high",
          notes: ["Identified as critical file"],
        },
      },
    };
    const mems = fileInsightsToMemories(data, PID);
    expect(mems).toHaveLength(1);
    expect(mems[0].kind).toBe("project_fact");
    expect(mems[0].scope).toBe("file");
    expect(mems[0].files).toEqual(["package.json"]);
    expect(mems[0].severity).toBe("high");
    expect(mems[0].text).toMatch(
      /Node\.js dependencies — Identified as critical file/,
    );
  });
});

describe("userPrefsToMemories", () => {
  it("maps quirks and non-empty style objects to user_preference", () => {
    const data = {
      preferences: {
        communicationStyle: { tone: "concise" },
        codeStyle: {},
        workflow: {},
        quirks: ["dislikes emoji in commits"],
      },
    };
    const mems = userPrefsToMemories(data, PID);
    expect(mems.every((m) => m.kind === "user_preference")).toBe(true);
    expect(mems.some((m) => m.text === "dislikes emoji in commits")).toBe(true);
    expect(mems.some((m) => m.text.startsWith("communicationStyle:"))).toBe(
      true,
    );
    // empty objects contribute nothing
    expect(mems.some((m) => m.text.startsWith("codeStyle:"))).toBe(false);
  });
});

describe("collectBrainMigrations — produces valid, persistable memories", () => {
  let brainDir: string;
  beforeEach(() => {
    brainDir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-"));
  });
  afterEach(() => {
    fs.rmSync(brainDir, { recursive: true, force: true });
  });

  it("reads all four files and every result validates", () => {
    fs.writeFileSync(
      path.join(brainDir, "lessons.jsonl"),
      JSON.stringify({
        type: "note",
        lesson: "build broke on CRLF",
        severity: "high",
      }) + "\n",
    );
    fs.writeFileSync(
      path.join(brainDir, "conventions.json"),
      JSON.stringify({
        patterns: { imports: "absolute" },
        namingConventions: {},
      }),
    );
    fs.writeFileSync(
      path.join(brainDir, "file-insights.json"),
      JSON.stringify({
        insights: { "a.ts": { role: "entry", risk: "low", notes: [] } },
      }),
    );
    fs.writeFileSync(
      path.join(brainDir, "user-prefs.json"),
      JSON.stringify({ preferences: { quirks: ["no emoji"] } }),
    );

    const mems = collectBrainMigrations(brainDir, PID);
    expect(mems.length).toBe(4);
    for (const input of mems) {
      expect(validateMemory(normalizeMemory(input)).valid).toBe(true);
    }
  });

  it("tolerates missing/corrupt files", () => {
    fs.writeFileSync(path.join(brainDir, "lessons.jsonl"), "{bad json\n");
    fs.writeFileSync(path.join(brainDir, "conventions.json"), "not json");
    expect(collectBrainMigrations(brainDir, PID)).toEqual([]);
  });
});
