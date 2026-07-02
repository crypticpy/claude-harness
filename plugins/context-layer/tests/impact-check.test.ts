import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  checkImpact,
  findNamespaceSymbolUsages,
} from "../src/tools/impact-check";

let projectDir: string;
let prevCodeMap: string | undefined;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "impact-mjs-"));
  // Force the grep/import-map fallback by disabling the code-map index. This
  // exercises findProjectFiles + buildImportMaps directly.
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
    // Fallback scan (code-map off, no symbol) is the import-level tier.
    expect(res.data!.provenance).toEqual({ strategy: "scan", complete: false });
    // Exactly one dependent — subject/verb must agree: "file that depends".
    expect(
      res.data!.suggestions.some((s) =>
        s.includes("1 file that depends on this file"),
      ),
    ).toBe(true);
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

describe("findNamespaceSymbolUsages — regex-safe identifier matching", () => {
  it("matches a symbol carrying a regex metacharacter ($)", async () => {
    // `$mount` is a real identifier (Vue). Unescaped, the `$` anchors the regex
    // and the usage is silently missed; escaping makes it match.
    const file = path.join(projectDir, "uses-vue.ts");
    fs.writeFileSync(file, "vue.$mount(el);\nconst x = 1;\n");
    const deps = await findNamespaceSymbolUsages(file, "vue", "$mount");
    expect(deps).toHaveLength(1);
    expect(deps[0].line).toBe(1);
    expect(deps[0].symbolUsed).toBe("$mount");
  });

  it("still matches a plain namespaced symbol", async () => {
    const file = path.join(projectDir, "uses-plain.ts");
    fs.writeFileSync(file, "const r = utils.format(x);\n");
    const deps = await findNamespaceSymbolUsages(file, "utils", "format");
    expect(deps).toHaveLength(1);
  });

  it("does not treat the symbol as a wildcard pattern", async () => {
    // A symbol like `a.b` (hypothetical metachar) must match literally, not as
    // "any char". `parse` must not match `xarsey` etc. via `.`-as-wildcard.
    const file = path.join(projectDir, "uses-dot.ts");
    fs.writeFileSync(file, "ns.p_rse(x);\n"); // would match ns.parse if `.` were wild
    const deps = await findNamespaceSymbolUsages(file, "ns", "p.rse");
    expect(deps).toHaveLength(0);
  });
});
