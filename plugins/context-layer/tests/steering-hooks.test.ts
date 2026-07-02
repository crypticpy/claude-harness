import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const { buildSteeringInjection, postEditSteering } = await import(
  "../../../hooks/unified/modules/steering.mjs"
);
const { writeCharter, manifestAdd } = await import(
  "../../../hooks/unified/modules/steering-store.mjs"
);

let projectDir: string;

beforeEach(() => {
  projectDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "steering-hooks-")),
  );
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

function editEvent(file: string) {
  return {
    session_id: "s1",
    cwd: projectDir,
    tool_name: "Edit",
    tool_input: { file_path: file },
  };
}

describe("buildSteeringInjection — post-compaction anchor", () => {
  it("returns '' when neither charter nor manifest exists", () => {
    expect(buildSteeringInjection(projectDir)).toBe("");
    expect(buildSteeringInjection(null)).toBe("");
  });

  it("re-injects the mission VERBATIM — exact substring, formatting intact", () => {
    const mission =
      "Refactor the auth module to session tokens.\n\n  1. keep the public API frozen\n  2. `verifyLegacy()` stays until step 12";
    writeCharter(projectDir, {
      mission,
      scope: ["src/auth/"],
      constraints: ["no new dependencies"],
    });

    const out = buildSteeringInjection(projectDir);
    expect(out).toContain(mission); // word-for-word, never summarized
    expect(out).toContain("src/auth/");
    expect(out).toContain("- no new dependencies");
  });

  it("lists remaining manifest items and caps the listing", () => {
    const files = Array.from({ length: 20 }, (_, i) => ({
      file: `src/m${String(i).padStart(2, "0")}.ts`,
    }));
    manifestAdd(projectDir, files);

    const out = buildSteeringInjection(projectDir);
    expect(out).toContain("20 of 20 work item(s) remaining");
    expect(out).toContain("- [ ] src/m00.ts");
    expect(out).toContain("…and 5 more");
    expect(out).not.toContain("src/m19.ts"); // beyond the 15-item cap
  });
});

describe("postEditSteering — tick-off + drift tripwire", () => {
  it("ticks pending items for the edited file and reports the remaining count", () => {
    manifestAdd(projectDir, [{ file: "src/a.ts" }, { file: "src/b.ts" }]);

    const note = postEditSteering(editEvent(path.join(projectDir, "src/a.ts")), {
      projectDir,
    });
    expect(note).toContain("[manifest] ✓ src/a.ts");
    expect(note).toContain("1 of 2 work item(s) remaining");

    // Second edit of the same file: already ticked, nothing to say.
    const again = postEditSteering(editEvent(path.join(projectDir, "src/a.ts")), {
      projectDir,
    });
    expect(again).toBeNull();
  });

  it("warns when an edit lands outside the charter scope", () => {
    writeCharter(projectDir, { mission: "m", scope: ["src/auth/"] });

    const inScope = postEditSteering(
      editEvent(path.join(projectDir, "src/auth/login.ts")),
      { projectDir },
    );
    expect(inScope).toBeNull();

    const outOfScope = postEditSteering(
      editEvent(path.join(projectDir, "src/billing/pay.ts")),
      { projectDir },
    );
    expect(outOfScope).toContain("[charter] ⚠ src/billing/pay.ts");
    expect(outOfScope).toContain("src/auth/");
  });

  it("stays silent for charters without scope and for files outside the repo", () => {
    writeCharter(projectDir, { mission: "m" }); // no scope → no tripwire
    expect(
      postEditSteering(editEvent(path.join(projectDir, "anywhere.ts")), {
        projectDir,
      }),
    ).toBeNull();
    expect(
      postEditSteering(editEvent("/completely/elsewhere/file.ts"), { projectDir }),
    ).toBeNull();
  });

  it("fails open on malformed events", () => {
    expect(postEditSteering({}, { projectDir })).toBeNull();
    expect(postEditSteering(null, { projectDir })).toBeNull();
  });
});
