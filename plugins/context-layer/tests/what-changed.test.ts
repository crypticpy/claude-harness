import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { whatChanged } from "../src/tools/what-changed";

let projectDir: string;
const saved = {
  flag: process.env.PUNTAX_EVENT_LEDGER,
  cfg: process.env.PUNTAX_CONFIG_PATH,
};

function writeEvents(...events: Record<string, unknown>[]): void {
  const dir = path.join(projectDir, ".claude", "context-layer");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "events.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-wc-"));
  // Force a deterministic config: point at a nonexistent file so loadPuntaxConfig
  // falls to defaults, then let the env flag decide eventLedger.enabled.
  process.env.PUNTAX_CONFIG_PATH = path.join(projectDir, "no-such-config.json");
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
  if (saved.flag === undefined) delete process.env.PUNTAX_EVENT_LEDGER;
  else process.env.PUNTAX_EVENT_LEDGER = saved.flag;
  if (saved.cfg === undefined) delete process.env.PUNTAX_CONFIG_PATH;
  else process.env.PUNTAX_CONFIG_PATH = saved.cfg;
});

describe("whatChanged — event ledger", () => {
  it("includes recent ledger events for the file when the ledger is enabled", async () => {
    process.env.PUNTAX_EVENT_LEDGER = "true";
    writeEvents(
      {
        id: "evt_1",
        kind: "edit",
        ts: "2026-06-29T00:00:00.000Z",
        tool: "Edit",
        outcome: "ok",
        files: ["src/foo.ts"],
        summary: "edit foo",
      },
      {
        id: "evt_2",
        kind: "read",
        ts: "2026-06-29T01:00:00.000Z",
        tool: "Read",
        outcome: "ok",
        files: ["src/other.ts"],
      },
    );

    const res = await whatChanged({
      filePath: "src/foo.ts",
      projectPath: projectDir,
    });
    expect(res.ledgerEvents).toBeDefined();
    expect(res.ledgerEvents).toHaveLength(1);
    expect(res.ledgerEvents![0].kind).toBe("edit");
  });

  it("omits ledger events when the ledger is disabled", async () => {
    process.env.PUNTAX_EVENT_LEDGER = "false";
    writeEvents({
      id: "evt_1",
      kind: "edit",
      ts: "2026-06-29T00:00:00.000Z",
      outcome: "ok",
      files: ["src/foo.ts"],
    });

    const res = await whatChanged({
      filePath: "src/foo.ts",
      projectPath: projectDir,
    });
    expect(res.ledgerEvents).toBeUndefined();
  });

  it("does not throw when there is no ledger file", async () => {
    process.env.PUNTAX_EVENT_LEDGER = "true";
    const res = await whatChanged({
      filePath: "src/foo.ts",
      projectPath: projectDir,
    });
    expect(res.ledgerEvents).toBeUndefined();
    expect(res.filePath).toContain("foo.ts");
  });
});
