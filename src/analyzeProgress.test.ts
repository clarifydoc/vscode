import { describe, expect, it } from "vitest";
import { AnalyzeProgress } from "./analyzeProgress";

const ev = (o: object) => JSON.stringify(o);

describe("analyze progress events", () => {
  it("fills the bar with files to 80%, the later stages to 100, and says where the run is", () => {
    const p = new AnalyzeProgress();
    const updates = [
      ev({ event: "stage", stage: "discover", label: "Discovering files" }),
      ev({ event: "stage", stage: "analyze", label: "Analyzing 200 files", filesTotal: 200 }),
      ev({ event: "files", done: 50, total: 200 }),
      ev({ event: "files", done: 200, total: 200 }),
      ev({ event: "stage", stage: "link", label: "Building dependency graph" }),
      ev({ event: "step", stage: "advanced", label: "Finding unreachable code" }),
      ev({ event: "done", ms: 10, files: 200 }),
    ].map((l) => p.update(l));
    expect(updates.map((u) => u?.message)).toEqual([
      "discovering files", "analyzing 200 files", "analyzing files 50/200", "analyzing files 200/200",
      "building dependency graph", "finding unreachable code", "done",
    ]);
    const total = updates.reduce((n, u) => n + (u?.increment ?? 0), 0);
    expect(total).toBe(100);
    expect(updates[2]!.increment).toBe(20);
  });

  it("tells an event line from output", () => {
    expect(AnalyzeProgress.isEvent('{"event":"files","done":1,"total":2}')).toBe(true);
    expect(AnalyzeProgress.isEvent("  Analyzing: src/a.ts")).toBe(false);
    expect(new AnalyzeProgress().update("{not json")).toBeNull();
  });
});
