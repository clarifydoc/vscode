import { describe, expect, it } from "vitest";
import { parseLineRanges, testCoverageOf } from "./analysisData";

describe("test coverage from the analysis", () => {
  it("reads uncovered ranges", () => {
    expect(parseLineRanges("3-5,9,12-14")).toEqual([[3, 5], [9, 9], [12, 14]]);
    expect(parseLineRanges("")).toEqual([]);
  });

  it("keeps files with counted lines, with the reports they came from", () => {
    const m = testCoverageOf({
      sources: [{ file: "coverage/lcov.info", stale: true }],
      files: [{ file: "src/a.ts", total: 4, covered: 1, uncovered: "2-4" }, { file: "src/empty.ts", total: 0, covered: 0, uncovered: "" }],
    });
    expect([...m.keys()]).toEqual(["src/a.ts"]);
    expect(m.get("src/a.ts")).toEqual({ total: 4, covered: 1, uncovered: [[2, 4]], sources: ["coverage/lcov.info"], stale: true });
    expect(testCoverageOf(undefined).size).toBe(0);
  });
});
