import { describe, it, expect } from "vitest";

import { callLlm } from "../../../hooks/unified/modules/llm-call.mjs";

const CFG = { engine: "claude-cli", model: "haiku", maxTokens: 1234 };

describe("callLlm (headless claude CLI)", () => {
  it("spawns `claude -p` with the model, prompt on stdin, and guard env", async () => {
    let call: any = null;
    const exec = (cmd: string, args: string[], opts: any) => {
      call = { cmd, args, opts };
      return "hello world";
    };
    const out = await callLlm(null, CFG, "the prompt", {
      format: "text",
      exec,
    } as any);
    expect(out).toBe("hello world");
    expect(call.cmd).toBe("claude");
    expect(call.args).toEqual([
      "-p",
      "--model",
      "haiku",
      "--output-format",
      "text",
    ]);
    expect(call.opts.input).toBe("the prompt");
    // Recursion guard: the spawned CLI's hooks must exit immediately.
    expect(call.opts.env.CLAUDE_HOOK_LLM_SPAWNED).toBe("1");
    // maxTokens can't be a CLI flag — forwarded (advisory) via env.
    expect(call.opts.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("1234");
  });

  it("json format extracts the first JSON object from chatty output", async () => {
    const exec = () => 'Sure, here you go:\n{"a": 1, "b": [2]}';
    const out = await callLlm(null, CFG, "p", { exec } as any);
    expect(out).toEqual({ a: 1, b: [2] });
  });

  it("returns null when the CLI is missing (ENOENT) — fail-open", async () => {
    const exec = () => {
      const e: any = new Error("spawn claude ENOENT");
      e.code = "ENOENT";
      throw e;
    };
    expect(await callLlm(null, CFG, "p", { exec } as any)).toBeNull();
  });

  it("returns null on empty output or JSON-less output in json mode", async () => {
    expect(
      await callLlm(null, CFG, "p", { exec: () => "  \n" } as any),
    ).toBeNull();
    expect(
      await callLlm(null, CFG, "p", { exec: () => "no json here" } as any),
    ).toBeNull();
  });

  it("caps oversized prompts on whole input (maxTokens stays advisory)", async () => {
    let input = "";
    const exec = (_c: string, _a: string[], opts: any) => {
      input = opts.input;
      return "ok";
    };
    await callLlm(null, CFG, "y".repeat(800_000), {
      format: "text",
      exec,
    } as any);
    expect(input.length).toBeLessThan(800_000);
    expect(input.endsWith("...[TRUNCATED]")).toBe(true);
  });

  it("defaults the model to haiku when config is missing", async () => {
    let args: string[] = [];
    const exec = (_c: string, a: string[]) => {
      args = a;
      return "ok";
    };
    await callLlm(null, undefined as any, "p", { format: "text", exec } as any);
    expect(args).toContain("haiku");
  });
});
