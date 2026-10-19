import { describe, expect, it } from "vitest";
import { decideSaveLoop, isUpToDateRun, saveLoopSetting } from "./saveLoop";

describe("saveLoopSetting", () => {
  it("reads the old boolean as on / off, and anything else as auto", () => {
    expect(saveLoopSetting(true)).toBe("on");
    expect(saveLoopSetting(false)).toBe("off");
    expect(saveLoopSetting("off")).toBe("off");
    expect(saveLoopSetting(undefined)).toBe("auto");
    expect(saveLoopSetting("sometimes")).toBe("auto");
  });
});

describe("decideSaveLoop", () => {
  it("auto: on where the last analysis was quick, off where it was slow or never timed", () => {
    expect(decideSaveLoop("auto", 800)).toMatchObject({ on: true, debounceMs: 1000 });
    expect(decideSaveLoop("auto", 4000)).toMatchObject({ on: true, debounceMs: 2500 });
    expect(decideSaveLoop("auto", 9300)).toMatchObject({ on: false });
    expect(decideSaveLoop("auto", 9300).why).toMatch(/9\.3 s, over 5\.0 s/);
    expect(decideSaveLoop("auto", undefined)).toMatchObject({ on: false });
  });

  it("on and off are what they say, whatever the timing", () => {
    expect(decideSaveLoop("on", 18_000)).toMatchObject({ on: true, debounceMs: 2500 });
    expect(decideSaveLoop("off", 100)).toMatchObject({ on: false });
  });
});

describe("isUpToDateRun", () => {
  it("spots the analyzer's up-to-date exit", () => {
    expect(isUpToDateRun("Analyzing…\nUp to date: nothing changed since the last run, so nothing was rebuilt.\n")).toBe(true);
    expect(isUpToDateRun("Done. Analysis complete.\n")).toBe(false);
  });
});
