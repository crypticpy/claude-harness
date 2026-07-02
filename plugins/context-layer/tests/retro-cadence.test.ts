import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  bumpCompactionCount,
  resetRetroCounter,
  buildRetroSuggestion,
  readCount,
} from "../../../hooks/unified/modules/retro-cadence.mjs";

let tmp: string;
let countFile: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cadence-"));
  countFile = path.join(tmp, "compaction-count.json");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("retro-cadence", () => {
  it("bumps both counters per compaction and resets sinceLastRetro on retro", () => {
    bumpCompactionCount({ countFile });
    bumpCompactionCount({ countFile });
    const after = bumpCompactionCount({ countFile });
    expect(after).toMatchObject({ total: 3, sinceLastRetro: 3 });

    expect(resetRetroCounter({ countFile })).toBe(true);
    const c = readCount({ countFile });
    expect(c.total).toBe(3); // total is lifetime — never reset
    expect(c.sinceLastRetro).toBe(0);
    expect(c.lastRetroAt).toBeTruthy();
  });

  it("suggests only at/over the threshold, with a 24h cooldown", () => {
    const config = { evolution: { suggestRetroAfterCompactions: 2 } };
    bumpCompactionCount({ countFile });
    expect(buildRetroSuggestion(config, { countFile })).toBeNull(); // 1 < 2

    bumpCompactionCount({ countFile });
    const t0 = Date.parse("2026-07-02T00:00:00Z");
    const first = buildRetroSuggestion(config, { countFile, now: t0 });
    expect(first).toContain("/retrospective");
    expect(first).toContain("2 compactions");

    // Within the cooldown: silent, even though still over threshold.
    expect(buildRetroSuggestion(config, { countFile, now: t0 + 3_600_000 })).toBeNull();
    // Past the cooldown: suggests again.
    expect(buildRetroSuggestion(config, { countFile, now: t0 + 25 * 3_600_000 })).toBeTruthy();
  });

  it("threshold 0 disables suggestions; missing file reads as zeros", () => {
    bumpCompactionCount({ countFile });
    expect(
      buildRetroSuggestion({ evolution: { suggestRetroAfterCompactions: 0 } }, { countFile }),
    ).toBeNull();
    expect(readCount({ countFile: path.join(tmp, "missing.json") })).toMatchObject({
      total: 0,
      sinceLastRetro: 0,
    });
  });
});
