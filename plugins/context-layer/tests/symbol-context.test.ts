import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  extractTypeName,
  getSymbolContext,
} from "../src/tools/symbol-context";

describe("extractTypeName — unwraps builtin container generics", () => {
  it("returns a plain identifier unchanged", () => {
    expect(extractTypeName("Widget")).toBe("Widget");
    expect(extractTypeName("string")).toBe("string");
  });

  it("peels array shorthand (incl. nested)", () => {
    expect(extractTypeName("User[]")).toBe("User");
    expect(extractTypeName("User[][]")).toBe("User");
  });

  it("unwraps Promise/Array/Set to the inner type", () => {
    expect(extractTypeName("Promise<User>")).toBe("User");
    expect(extractTypeName("Array<User>")).toBe("User");
    expect(extractTypeName("Set<Widget>")).toBe("Widget");
  });

  it("makes T[] and Array<T> agree", () => {
    expect(extractTypeName("Order[]")).toBe(extractTypeName("Array<Order>"));
  });

  it("skips primitive type args and surfaces the first meaningful one", () => {
    expect(extractTypeName("Map<string, Config>")).toBe("Config");
  });

  it("returns null when a container holds only primitives", () => {
    // No navigable inner type — the caller adds no related symbol.
    expect(extractTypeName("Promise<void>")).toBeNull();
    expect(extractTypeName("Map<string, number>")).toBeNull();
  });

  it("unwraps Record/Partial utility types (Record name is not navigable)", () => {
    expect(extractTypeName("Record<string, Handler>")).toBe("Handler");
    expect(extractTypeName("Partial<Widget>")).toBe("Widget");
  });

  it("recurses through nested containers", () => {
    expect(extractTypeName("Promise<Widget[]>")).toBe("Widget");
    expect(extractTypeName("Promise<Map<string, Cfg>>")).toBe("Cfg");
  });

  it("keeps a user-defined generic's outer name", () => {
    expect(extractTypeName("Result<T>")).toBe("Result");
  });

  it("takes the leading identifier of a union", () => {
    expect(extractTypeName("Widget | null")).toBe("Widget");
  });

  it("returns null when no identifier is present", () => {
    expect(extractTypeName("")).toBeNull();
    expect(extractTypeName("<>")).toBeNull();
  });
});

describe("getSymbolContext — related symbols from generic return types", () => {
  let dir: string;
  let prevLsp: string | undefined;
  let prevCodeMap: string | undefined;

  beforeEach(() => {
    // Force the AST tier so the pure type-relationship logic is exercised
    // deterministically (no language server, no code-map index).
    prevLsp = process.env.PUNTAX_LSP;
    prevCodeMap = process.env.PUNTAX_CODE_MAP;
    process.env.PUNTAX_LSP = "false";
    process.env.PUNTAX_CODE_MAP = "false";
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "symctx-")));
  });

  afterEach(() => {
    if (prevLsp === undefined) delete process.env.PUNTAX_LSP;
    else process.env.PUNTAX_LSP = prevLsp;
    if (prevCodeMap === undefined) delete process.env.PUNTAX_CODE_MAP;
    else process.env.PUNTAX_CODE_MAP = prevCodeMap;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("surfaces the inner type of a Promise<T> return (previously lost)", async () => {
    const file = path.join(dir, "svc.ts");
    fs.writeFileSync(
      file,
      [
        "export interface Widget { id: number; }",
        "export async function fetchWidget(): Promise<Widget> { return { id: 1 }; }",
        "",
      ].join("\n"),
    );
    const res = await getSymbolContext({
      symbolName: "fetchWidget",
      filePath: file,
      projectPath: dir,
    });
    expect(res).not.toBeNull();
    expect(res!.related.some((r) => r.name === "Widget")).toBe(true);
    // AST tier (no LSP, no index): structural signature, not type-resolved.
    expect(res!.provenance).toEqual({ strategy: "parse", complete: false });
  });
});
