import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  readPuntaxConfig,
  envFlag,
  DEFAULT_PUNTAX,
  loadPuntaxConfig,
} from "../src/config/puntax-config";

// Cross-runtime parity: the hook `.mjs` loader must agree with the TS port.
import {
  readPuntaxConfig as readPuntaxConfigMjs,
  DEFAULT_PUNTAX as DEFAULT_PUNTAX_MJS,
} from "../../../hooks/unified/modules/puntax-config.mjs";

describe("readPuntaxConfig — defaults", () => {
  it("returns the default settings for empty config and env", () => {
    const cfg = readPuntaxConfig({}, {});
    expect(cfg.contextRouter.enabled).toBe(true);
    expect(cfg.contextRouter.budgets.prompt).toBe(300);
    expect(cfg.contextRouter.budgets.architecture).toBe(3000);
    expect(cfg.eventLedger.enabled).toBe(false);
    expect(cfg.precompact.mode).toBe("deterministic");
    expect(cfg.codeMap.enabled).toBe(false);
    expect(cfg.lsp.enabled).toBe(false);
    expect(cfg.llmDistillation.enabled).toBe(false);
  });

  it("does not mutate DEFAULT_PUNTAX", () => {
    const cfg = readPuntaxConfig(
      { puntax: { contextRouter: { budgets: { prompt: 999 } } } },
      {},
    );
    expect(cfg.contextRouter.budgets.prompt).toBe(999);
    expect(DEFAULT_PUNTAX.contextRouter.budgets.prompt).toBe(300);
  });

  it("does not leak env-driven flags into DEFAULT_PUNTAX (subsystem not in config block)", () => {
    readPuntaxConfig(
      {},
      { PUNTAX_LLM_DISTILLATION: "yes", PUNTAX_EVENT_LEDGER: "on" },
    );
    // The shared default must stay pristine for the next caller.
    expect(DEFAULT_PUNTAX.llmDistillation.enabled).toBe(false);
    expect(DEFAULT_PUNTAX.eventLedger.enabled).toBe(false);
  });
});

describe("readPuntaxConfig — config block merge", () => {
  it("deep-merges partial budgets, preserving unspecified defaults", () => {
    const cfg = readPuntaxConfig(
      { puntax: { contextRouter: { budgets: { prompt: 500 } } } },
      {},
    );
    expect(cfg.contextRouter.budgets.prompt).toBe(500);
    expect(cfg.contextRouter.budgets.pre_edit).toBe(1200); // untouched default
  });

  it("replaces array fields wholesale", () => {
    const cfg = readPuntaxConfig(
      { puntax: { codeMap: { backendOrder: ["regex"] } } },
      {},
    );
    expect(cfg.codeMap.backendOrder).toEqual(["regex"]);
  });
});

describe("readPuntaxConfig — env overrides", () => {
  it("flips subsystem enabled flags via env", () => {
    const cfg = readPuntaxConfig(
      {},
      {
        PUNTAX_CONTEXT_ROUTER: "false",
        PUNTAX_EVENT_LEDGER: "1",
        PUNTAX_CODE_MAP: "on",
        PUNTAX_LSP: "true",
        PUNTAX_LLM_DISTILLATION: "yes",
      },
    );
    expect(cfg.contextRouter.enabled).toBe(false);
    expect(cfg.eventLedger.enabled).toBe(true);
    expect(cfg.codeMap.enabled).toBe(true);
    expect(cfg.lsp.enabled).toBe(true);
    expect(cfg.llmDistillation.enabled).toBe(true);
  });

  it("defaults PUNTAX_LSP to off when unset and respects false", () => {
    expect(readPuntaxConfig({}, {}).lsp.enabled).toBe(false);
    expect(readPuntaxConfig({}, { PUNTAX_LSP: "off" }).lsp.enabled).toBe(false);
    expect(
      readPuntaxConfig({ puntax: { lsp: { enabled: true } } }, {}).lsp.enabled,
    ).toBe(true);
    // Env override wins over config block.
    expect(
      readPuntaxConfig(
        { puntax: { lsp: { enabled: true } } },
        { PUNTAX_LSP: "no" },
      ).lsp.enabled,
    ).toBe(false);
  });

  it("honors PUNTAX_PRECOMPACT_MODE only for valid values", () => {
    expect(
      readPuntaxConfig({}, { PUNTAX_PRECOMPACT_MODE: "deterministic" })
        .precompact.mode,
    ).toBe("deterministic");
    expect(
      readPuntaxConfig({}, { PUNTAX_PRECOMPACT_MODE: "llm" }).precompact.mode,
    ).toBe("llm");
    // Garbage leaves the default in place (v2 default: deterministic).
    expect(
      readPuntaxConfig({}, { PUNTAX_PRECOMPACT_MODE: "banana" }).precompact
        .mode,
    ).toBe("deterministic");
  });

  it("ignores unrecognized env values (no silent flip)", () => {
    const cfg = readPuntaxConfig({}, { PUNTAX_CONTEXT_ROUTER: "banana" });
    expect(cfg.contextRouter.enabled).toBe(true);
  });

  it("env overrides win over config block", () => {
    const cfg = readPuntaxConfig(
      { puntax: { contextRouter: { enabled: true } } },
      { PUNTAX_CONTEXT_ROUTER: "off" },
    );
    expect(cfg.contextRouter.enabled).toBe(false);
  });
});

describe("envFlag — tri-state parsing", () => {
  it("returns fallback when unset or empty", () => {
    expect(envFlag({}, "X", true)).toBe(true);
    expect(envFlag({ X: "" }, "X", false)).toBe(false);
  });
  it("parses truthy and falsy tokens", () => {
    for (const t of ["1", "true", "YES", "On"])
      expect(envFlag({ X: t }, "X", false)).toBe(true);
    for (const f of ["0", "false", "NO", "Off"])
      expect(envFlag({ X: f }, "X", true)).toBe(false);
  });
});

describe("loadPuntaxConfig — disk loading", () => {
  it("loads and normalizes from an explicit config.json path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-cfg-"));
    const file = path.join(dir, "config.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        puntax: { contextRouter: { budgets: { prompt: 42 } } },
      }),
    );
    const cfg = loadPuntaxConfig({ explicitPath: file, env: {} });
    expect(cfg.contextRouter.budgets.prompt).toBe(42);
    expect(cfg.contextRouter.budgets.pre_edit).toBe(1200);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to defaults when no config file is found", () => {
    const cfg = loadPuntaxConfig({
      explicitPath: "/nonexistent/puntax/config.json",
      env: {},
    });
    expect(cfg.contextRouter.budgets.prompt).toBe(300);
  });

  it("falls back to defaults on corrupt JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-cfg-"));
    const file = path.join(dir, "config.json");
    fs.writeFileSync(file, "{ not valid json");
    const cfg = loadPuntaxConfig({ explicitPath: file, env: {} });
    expect(cfg.contextRouter.budgets.prompt).toBe(300);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("cross-runtime parity (.ts vs .mjs)", () => {
  it("default tables match", () => {
    expect(DEFAULT_PUNTAX_MJS).toEqual(DEFAULT_PUNTAX);
  });

  it("produce identical output for the same inputs", () => {
    const config = {
      puntax: {
        contextRouter: { budgets: { prompt: 250 } },
        codeMap: { enabled: true },
      },
    };
    const env = {
      PUNTAX_EVENT_LEDGER: "true",
      PUNTAX_PRECOMPACT_MODE: "deterministic",
    };
    expect(readPuntaxConfigMjs(config, env)).toEqual(
      readPuntaxConfig(config, env),
    );
  });
});
