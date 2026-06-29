import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { sessionCheckpoint } from "../src/tools/session-checkpoint";

let projectDir: string;
let ckptFile: string;

function writeCkpt(obj: Record<string, unknown>): void {
  fs.appendFileSync(ckptFile, JSON.stringify(obj) + "\n");
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-ckpt-"));
  const dir = path.join(projectDir, ".claude", "context-layer");
  fs.mkdirSync(dir, { recursive: true });
  ckptFile = path.join(dir, "checkpoints.jsonl");
});
afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("sessionCheckpoint", () => {
  it("returns null with a message when no checkpoints exist", async () => {
    const res = await sessionCheckpoint({ projectPath: projectDir });
    expect(res.checkpoint).toBeNull();
    expect(res.total).toBe(0);
  });

  it("returns the latest checkpoint (append-only, last wins)", async () => {
    writeCkpt({
      type: "checkpoint",
      session_id: "s",
      checkpointIndex: 0,
      changedFiles: ["a.ts"],
    });
    writeCkpt({
      type: "checkpoint",
      session_id: "s",
      checkpointIndex: 1,
      changedFiles: ["b.ts"],
    });
    const res = await sessionCheckpoint({ projectPath: projectDir });
    expect(res.total).toBe(2);
    expect(res.checkpoint?.checkpointIndex).toBe(1);
    expect(res.checkpoint?.changedFiles).toEqual(["b.ts"]);
  });

  it("filters by sessionId", async () => {
    writeCkpt({ type: "checkpoint", session_id: "s1", checkpointIndex: 0 });
    writeCkpt({ type: "checkpoint", session_id: "s2", checkpointIndex: 9 });
    const res = await sessionCheckpoint({
      projectPath: projectDir,
      sessionId: "s1",
    });
    expect(res.total).toBe(1);
    expect(res.checkpoint?.session_id).toBe("s1");
  });

  it("tolerates corrupt lines", async () => {
    fs.appendFileSync(ckptFile, "{ broken\n");
    writeCkpt({ type: "checkpoint", session_id: "s", checkpointIndex: 3 });
    const res = await sessionCheckpoint({ projectPath: projectDir });
    expect(res.checkpoint?.checkpointIndex).toBe(3);
  });
});
