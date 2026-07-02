import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Hook-side ESM module one level up (same cross-runtime import pattern as
// precompact-reducer.test.ts).
import { emitLengthNudge } from "../../../hooks/unified/modules/file-length.mjs";

let tmp: string;

function makeFile(name: string, lines: number): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, Array.from({ length: lines }, (_, i) => `# line ${i}`).join("\n"));
  return p;
}

function ev(filePath: string, sessionId = "sess-1") {
  return { tool_input: { file_path: filePath }, session_id: sessionId, cwd: tmp };
}

const config = { qualityGates: { maxFileLines: 700 } };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flen-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("emitLengthNudge", () => {
  it("nudges once per file per session when a code file exceeds the ceiling", () => {
    const f = makeFile("big.py", 800);
    const first = emitLengthNudge(ev(f), config, { logDir: tmp });
    expect(first).toBeTruthy();
    expect(first).toContain("800 lines");
    expect(first).toContain("big.py");

    // Second edit in the same session: silent.
    expect(emitLengthNudge(ev(f), config, { logDir: tmp })).toBeNull();

    // A different session nudges again.
    expect(emitLengthNudge(ev(f, "sess-2"), config, { logDir: tmp })).toBeTruthy();
  });

  it("stays silent under the ceiling and for non-code files", () => {
    const small = makeFile("small.py", 100);
    expect(emitLengthNudge(ev(small), config, { logDir: tmp })).toBeNull();

    const doc = makeFile("notes.md", 2000);
    expect(emitLengthNudge(ev(doc), config, { logDir: tmp })).toBeNull();

    const data = makeFile("data.json", 2000);
    expect(emitLengthNudge(ev(data), config, { logDir: tmp })).toBeNull();
  });

  it("is disabled by maxFileLines: 0 and defaults to 700 when unset", () => {
    const f = makeFile("big.ts", 800);
    expect(emitLengthNudge(ev(f), { qualityGates: { maxFileLines: 0 } }, { logDir: tmp })).toBeNull();
    // No config at all → default 700 still applies.
    expect(emitLengthNudge(ev(f), {}, { logDir: tmp })).toBeTruthy();
  });

  it("fails open on missing input", () => {
    expect(emitLengthNudge({}, config, { logDir: tmp })).toBeNull();
    expect(
      emitLengthNudge(ev(path.join(tmp, "does-not-exist.py")), config, { logDir: tmp }),
    ).toBeNull();
  });
});
