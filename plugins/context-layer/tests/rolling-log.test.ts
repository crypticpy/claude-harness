import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// rolling-log resolves LOG_DIR from $HOME at module load — point HOME at a
// sandbox BEFORE importing so the test never touches the real harness state.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "rolling-home-"));
const savedHome = process.env.HOME;
process.env.HOME = tmpHome;

const { logOperation, getFileEditHistory, readFileEditsDb } = await import(
  "../../../hooks/unified/modules/rolling-log.mjs"
);
const { getDetailedFileHistory } = await import(
  "../../../hooks/unified/modules/edit-history.mjs"
);

const LOG_DIR = path.join(tmpHome, ".claude", "hooks", "unified", "logs");
const LEGACY_DB = path.join(LOG_DIR, "file-edits.json");
const SIDECAR = path.join(LOG_DIR, "file-edits.jsonl");
const PRUNE_MARKER = path.join(LOG_DIR, ".last-prune");

// Event-ledger mirroring off so the test stays scoped to the edit log.
const CFG = { puntax: { eventLedger: { enabled: false } } };

function editEvent(file: string, session = "s1") {
  return {
    session_id: session,
    tool_name: "Edit",
    tool_input: { file_path: file },
    tool_output: "ok",
  };
}

beforeEach(() => {
  for (const f of [LEGACY_DB, SIDECAR, PRUNE_MARKER]) {
    fs.rmSync(f, { force: true });
  }
});

afterAll(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("rolling-log file-edit tracking (append-only sidecar)", () => {
  it("appends one JSONL line per edit and never writes the legacy JSON DB", async () => {
    await logOperation(editEvent("/x/a.ts"), CFG);
    await logOperation(editEvent("/x/a.ts"), CFG);

    expect(fs.existsSync(SIDECAR)).toBe(true);
    const lines = fs
      .readFileSync(SIDECAR, "utf-8")
      .split("\n")
      .filter((l) => l.trim());
    expect(lines).toHaveLength(2);
    const row = JSON.parse(lines[0]);
    expect(row.filePath).toBe("/x/a.ts");
    expect(row.sessionId).toBe("s1");
    expect(typeof row.timestamp).toBe("string");

    // The old full-DB rewrite is gone.
    expect(fs.existsSync(LEGACY_DB)).toBe(false);
  });

  it("getFileEditHistory folds the sidecar into the old read shape", async () => {
    await logOperation(editEvent("/x/b.ts"), CFG);
    await logOperation(editEvent("/x/b.ts"), CFG);
    await logOperation(editEvent("/x/b.ts", "s2"), CFG);

    const hist: any = getFileEditHistory("/x/b.ts", "s1");
    expect(hist).not.toBeNull();
    expect(hist.totalEdits).toBe(3);
    expect(hist.sessionEdits).toBe(2);
    expect(hist.edits).toHaveLength(2);
    expect(typeof hist.firstEdit).toBe("string");
    expect(typeof hist.lastEdit).toBe("string");

    // Downstream reader (edit-history.mjs) sees the same folded view.
    const detail: any = getDetailedFileHistory("/x/b.ts");
    expect(detail.totalEdits).toBe(3);
    expect(detail.sessionCount).toBe(2);
  });

  it("folds the legacy file-edits.json in as a frozen migration base", async () => {
    const T = "2026-06-01T00:00:00.000Z";
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(
      LEGACY_DB,
      JSON.stringify({
        files: {
          "/x/old.ts": {
            editCount: 3,
            sessions: { s0: { edits: [{ timestamp: T, summary: null }], count: 3 } },
            firstEdit: T,
            lastEdit: T,
          },
        },
      }),
    );

    await logOperation(editEvent("/x/old.ts"), CFG);

    const db: any = readFileEditsDb();
    expect(db.files["/x/old.ts"].editCount).toBe(4); // 3 legacy + 1 sidecar
    expect(db.files["/x/old.ts"].sessions.s0.count).toBe(3);
    expect(db.files["/x/old.ts"].sessions.s1.count).toBe(1);
    expect(db.files["/x/old.ts"].firstEdit).toBe(T);

    // The legacy base is left in place, untouched.
    const legacy = JSON.parse(fs.readFileSync(LEGACY_DB, "utf-8"));
    expect(legacy.files["/x/old.ts"].editCount).toBe(3);
  });

  it("prune/GC compacts old sidecar lines (age-based)", async () => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(
      SIDECAR,
      JSON.stringify({
        filePath: "/x/stale.ts",
        sessionId: "s0",
        timestamp: "2000-01-01T00:00:00.000Z",
      }) + "\n",
    );

    // No prune marker → logOperation runs the GC path after appending.
    await logOperation(editEvent("/x/fresh.ts"), CFG);

    const rows = fs
      .readFileSync(SIDECAR, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(rows[0].filePath).toBe("/x/fresh.ts");
    expect(readFileEditsDb().files["/x/stale.ts"]).toBeUndefined();
  });

  it("readFileEditsDb tolerates a corrupt legacy base and corrupt sidecar lines", async () => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(LEGACY_DB, "{ not json");
    fs.writeFileSync(
      SIDECAR,
      "also not json\n" +
        JSON.stringify({
          filePath: "/x/ok.ts",
          sessionId: "s1",
          timestamp: new Date().toISOString(),
        }) + "\n",
    );
    const db: any = readFileEditsDb();
    expect(Object.keys(db.files)).toEqual(["/x/ok.ts"]);
    expect(db.files["/x/ok.ts"].editCount).toBe(1);
  });
});
