import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../hooks/unified/unified-hook.mjs",
);

function runHook(input: string, env: Record<string, string>) {
  return spawnSync(process.execPath, [HOOK, "prompt"], {
    input,
    env: { ...process.env, ...env },
    encoding: "utf-8" as const,
    timeout: 30_000,
  });
}

describe("unified-hook process behavior", () => {
  it("exits 0 immediately when CLAUDE_HOOK_LLM_SPAWNED=1 (recursion guard)", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "hook-home-"));
    try {
      const r = runHook("not even json", {
        HOME: home,
        CLAUDE_HOOK_LLM_SPAWNED: "1",
      });
      expect(r.status).toBe(0);
      // The guard fires before parsing — garbage stdin never reaches the
      // fatal path, so no errors.log appears.
      expect(
        fs.existsSync(
          path.join(home, ".claude", "hooks", "unified", "logs", "errors.log"),
        ),
      ).toBe(false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("logs a fatal error line to errors.log and exits 1", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "hook-home-"));
    try {
      const r = runHook("{{{ not json", {
        HOME: home,
        CLAUDE_HOOK_LLM_SPAWNED: "",
      });
      // Non-blocking failure signal: only exit 2 blocks in Claude Code hooks.
      expect(r.status).toBe(1);
      const logPath = path.join(
        home,
        ".claude",
        "hooks",
        "unified",
        "logs",
        "errors.log",
      );
      const log = fs.readFileSync(logPath, "utf-8");
      const lines = log.trim().split("\n");
      expect(lines).toHaveLength(1);
      // "<ISO timestamp> <event type> <error message>"
      expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z prompt .+/);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
