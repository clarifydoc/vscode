import { describe, expect, it } from "vitest";
import { FindingTracker } from "./newFindings";

const f = (message: string, filePath = "a.ts") => ({ filePath, category: "sql-injection", message });

describe("new findings", () => {
  it("treats the first analysis as the baseline", () => {
    const t = new FindingTracker();
    t.update("/ws", [f("one")]);
    expect(t.count("/ws", [f("one")])).toBe(0);
  });

  it("counts findings the previous analysis did not have, and survives a reload", () => {
    const t = new FindingTracker();
    t.update("/ws", [f("one")]);
    const next = [f("one"), f("two"), f("three", "b.ts")];
    t.update("/ws", next);
    expect(t.count("/ws", next)).toBe(2);
    t.update("/ws", [...next]); // same analysis loaded again
    expect(t.count("/ws", next)).toBe(2);
    expect(t.isNew("/ws", f("one"))).toBe(false);
  });

  it("persists across restarts through the store", () => {
    const data = new Map<string, unknown>();
    const store = { get: <T>(k: string) => data.get(k) as T | undefined, update: async (k: string, v: unknown) => void data.set(k, v) };
    const a = new FindingTracker(store);
    a.update("/ws", [f("one")]);
    a.update("/ws", [f("one"), f("two")]);
    const b = new FindingTracker(store);
    b.update("/ws", [f("one"), f("two")]);
    expect(b.isNew("/ws", f("two"))).toBe(true);
  });
});
