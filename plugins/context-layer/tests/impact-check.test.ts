import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { checkImpact } from "../src/tools/impact-check";

let projectDir: string;
let prevCodeMap: string | undefined;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "impact-mjs-"));
  // Force the grep/import-map fallback: disable the code-map index, and pass no
  // symbolName so the LSP tier is skipped too. This exercises findProjectFiles +
  // buildImportMaps directly.
  prevCodeMap = process.env.PUNTAX_CODE_MAP;
  process.env.PUNTAX_CODE_MAP = "false";
});

afterEach(() => {
  if (prevCodeMap === undefined) delete process.env.PUNTAX_CODE_MAP;
  else process.env.PUNTAX_CODE_MAP = prevCodeMap;
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("checkImpact — fallback scan covers .mjs/.cjs consumers", () => {
  it("finds a .mjs file that imports the target (explicit extension)", async () => {
    fs.writeFileSync(
      path.join(projectDir, "event-writer.mjs"),
      "export function writeEvent() {}\n",
    );
    fs.writeFileSync(
      path.join(projectDir, "rolling-log.mjs"),
      "import { writeEvent } from './event-writer.mjs';\nwriteEvent();\n",
    );

    const res = await checkImpact({
      filePath: path.join(projectDir, "event-writer.mjs"),
      projectPath: projectDir,
    });

    expect(res.success).toBe(true);
    const deps = res.data!.dependents.map((d) => path.basename(d.filePath));
    expect(deps).toContain("rolling-log.mjs");
  });

  it("resolves an extensionless import specifier to a .mjs target", async () => {
    fs.writeFileSync(
      path.join(projectDir, "util.mjs"),
      "export const helper = 1;\n",
    );
    fs.writeFileSync(
      path.join(projectDir, "consumer.mjs"),
      "import { helper } from './util';\nhelper;\n",
    );

    const res = await checkImpact({
      filePath: path.join(projectDir, "util.mjs"),
      projectPath: projectDir,
    });

    expect(res.success).toBe(true);
    const deps = res.data!.dependents.map((d) => path.basename(d.filePath));
    expect(deps).toContain("consumer.mjs");
  });
});
