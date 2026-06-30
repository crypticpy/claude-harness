import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildLintReport,
  lintFile,
} from "../../../hooks/unified/modules/format-lint.mjs";

describe("buildLintReport", () => {
  const eslintUnix = [
    "/p/src/a.ts:12:5: 'x' is defined but never used [no-unused-vars]",
    "/p/src/a.ts:14:1: Missing semicolon [semi]",
  ].join("\n");

  it("returns null when there are no diagnostic lines", () => {
    expect(buildLintReport("", { file: "a.ts", linter: "eslint" })).toBeNull();
    expect(
      buildLintReport("All good — no problems found!", { file: "a.ts" }),
    ).toBeNull();
  });

  it("counts issues and includes a fix-pre-existing nudge", () => {
    const r = buildLintReport(eslintUnix, {
      file: "src/a.ts",
      linter: "eslint",
    })!;
    expect(r).toContain("2 issue(s) in src/a.ts");
    expect(r).toContain("including pre-existing");
    expect(r).toContain("no-unused-vars");
  });

  it("bounds output to maxIssues and notes the remainder", () => {
    const many = Array.from(
      { length: 25 },
      (_, i) => `f.ts:${i + 1}:1: msg [r]`,
    ).join("\n");
    const r = buildLintReport(many, {
      file: "f.ts",
      linter: "eslint",
      maxIssues: 5,
    })!;
    expect(r).toContain("25 issue(s)");
    expect((r.match(/f\.ts:\d+:1:/g) || []).length).toBe(5);
    expect(r).toContain("+20 more");
  });
});

describe("lintFile — gating + read-only run", () => {
  let dir: string;
  const eslintCfg = {
    linting: {
      enabled: true,
      maxIssues: 20,
      linters: [
        {
          name: "eslint",
          exts: [".ts"],
          cmd: "npx --no-install eslint --format unix",
          requires: [".eslintrc.json"],
        },
      ],
    },
  };
  const evt = (file: string) => ({ tool_input: { file_path: file } });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("returns null when linting is disabled", () => {
    const f = path.join(dir, "a.ts");
    fs.writeFileSync(f, "const x = 1;\n");
    expect(
      lintFile(evt(f), { linting: { enabled: false } }, { projectDir: dir }),
    ).toBeNull();
  });

  it("returns null for an extension with no configured linter", () => {
    const f = path.join(dir, "a.go");
    fs.writeFileSync(f, "package main\n");
    expect(lintFile(evt(f), eslintCfg, { projectDir: dir })).toBeNull();
  });

  it("stays silent when the linter's config is absent (no noise)", () => {
    const f = path.join(dir, "a.ts");
    fs.writeFileSync(f, "const x = 1;\n");
    // No .eslintrc.json in dir → applicability gate blocks → eslint never runs.
    expect(lintFile(evt(f), eslintCfg, { projectDir: dir })).toBeNull();
  });

  it("runs the linter and reports issues when its config is present", () => {
    fs.writeFileSync(path.join(dir, ".eslintrc.json"), "{}\n");
    fs.writeFileSync(
      path.join(dir, "fakelint.sh"),
      'echo "src/a.ts:3:9: fake unused [no-x]"\n',
    );
    const f = path.join(dir, "a.ts");
    fs.writeFileSync(f, "const x = 1;\n");

    const report = lintFile(
      evt(f),
      {
        linting: {
          enabled: true,
          maxIssues: 20,
          linters: [
            {
              name: "fake",
              exts: [".ts"],
              cmd: "bash fakelint.sh",
              requires: [".eslintrc.json"],
            },
          ],
        },
      },
      { projectDir: dir },
    );

    expect(report).toContain("1 issue(s)");
    expect(report).toContain("fake unused");
    expect(report).toContain("not auto-fixed");
  });
});
