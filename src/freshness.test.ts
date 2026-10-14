import { describe, expect, it } from "vitest";
import { describeFreshness, FreshnessReport } from "./freshness";

const report = (over: Partial<FreshnessReport>): FreshnessReport => ({
  state: "fresh",
  changed: [],
  removed: [],
  checked: 10,
  sampled: false,
  ...over,
});

describe("describeFreshness", () => {
  it("says nothing when the analysis matches the files, or when it cannot tell", () => {
    expect(describeFreshness(report({}))).toEqual({ suffix: "", detail: "", stale: false });
    expect(describeFreshness(report({ state: "unknown" })).stale).toBe(false);
    expect(describeFreshness(undefined).stale).toBe(false);
  });

  it("counts changed and removed files and offers a re-analysis", () => {
    const note = describeFreshness(report({ state: "changed", changed: ["a.ts", "b.ts"], removed: ["c.ts"] }));
    expect(note.suffix).toBe(" · 3 changed");
    expect(note.detail).toContain("2 files changed, 1 file removed");
    expect(note.stale).toBe(true);
  });

  it("says 'at least' when only part of a large analysis was checked", () => {
    const note = describeFreshness(report({ state: "changed", changed: ["a.ts"], sampled: true }));
    expect(note.suffix).toBe(" · 1+ changed");
    expect(note.detail).toContain("at least");
  });

  it("asks for a re-analysis after the analyzer itself was updated", () => {
    const note = describeFreshness(report({ state: "extractor-changed" }));
    expect(note.suffix).toBe(" · update");
    expect(note.stale).toBe(true);
  });
});
