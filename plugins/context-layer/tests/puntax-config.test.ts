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
    expect(cfg.eventLedger.enabled).toBe(true);
    expect(cfg.precompact.mode).toBe("deterministic");
    expect(cfg.codeMap.enabled).toBe(true);
    expect(cfg.llmDistillation.enabled).toBe(true);
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
      { PUNTAX_LLM_DISTILLATION: "off", PUNTAX_EVENT_LEDGER: "off" },
    );
    // The shared default must stay pristine for the next caller.
    expect(DEFAULT_PUNTAX.llmDistillation.enabled).toBe(true);
    expect(DEFAULT_PUNTAX.eventLedger.enabled).toBe(true);
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
        PUNTAX_LLM_DISTILLATION: "no",
      },
    );
    expect(cfg.contextRouter.enabled).toBe(false);
    expect(cfg.eventLedger.enabled).toBe(true);
    expect(cfg.codeMap.enabled).toBe(true);
    expect(cfg.llmDistillation.enabled).toBe(false);
  });

  it("tolerates a legacy puntax.lsp block without erroring (ignore-and-drop)", () => {
    // The in-house LSP tier was removed; old config.json files may still carry
    // the block. Parsing must not throw and the rest of the config must load.
    const cfg = readPuntaxConfig(
      { puntax: { lsp: { enabled: true }, contextRouter: { budgets: { prompt: 77 } } } },
      { PUNTAX_LSP: "false" },
    );
    expect(cfg.contextRouter.budgets.prompt).toBe(77);
    expect(cfg.codeMap.enabled).toBe(true);
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

  it("re-applies env overrides on a cache hit (parse memoized, env not)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-cfg-cache-"));
    const file = path.join(dir, "config.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        puntax: { contextRouter: { budgets: { prompt: 42 } } },
      }),
    );
    // First load populates the raw-file cache.
    const a = loadPuntaxConfig({ explicitPath: file, env: {} });
    expect(a.contextRouter.budgets.prompt).toBe(42);
    expect(a.codeMap.enabled).toBe(true);
    // Same file (cache hit — prompt still 42) but a live env override must win.
    const b = loadPuntaxConfig({
      explicitPath: file,
      env: { PUNTAX_CODE_MAP: "false" },
    });
    expect(b.contextRouter.budgets.prompt).toBe(42);
    expect(b.codeMap.enabled).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("busts the cache when the file content changes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "puntax-cfg-bust-"));
    const file = path.join(dir, "config.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ puntax: { contextRouter: { budgets: { prompt: 42 } } } }),
    );
    expect(
      loadPuntaxConfig({ explicitPath: file, env: {} }).contextRouter.budgets
        .prompt,
    ).toBe(42);
    // Rewrite same path; the size key busts the cache even if mtime is coarse.
    fs.writeFileSync(
      file,
      JSON.stringify({ puntax: { contextRouter: { budgets: { prompt: 987654 } } } }),
    );
    expect(
      loadPuntaxConfig({ explicitPath: file, env: {} }).contextRouter.budgets
        .prompt,
    ).toBe(987654);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("cross-runtime parity (.ts vs .mjs)", () => {
  // Both runtimes dropped the `lsp` block when the in-house LSP tier was
  // removed, so the tables must be identical again — no key-stripping.
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
