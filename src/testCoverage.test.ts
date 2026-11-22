import { describe, expect, it } from "vitest";
import { parseLineRanges, routeCoverageKey, testCoverageOf, untestedFunction } from "./analysisData";
import { untestedRoutesOf } from "./analysisIndex";

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

describe("untested routes and functions", () => {
  it("reads the routes the analysis says no test runs", () => {
    const set = untestedRoutesOf([
      { filePath: "api/clubs.ts", httpMethod: "get", path: "/api/v2/clubs", testCoverage: { covered: 0, total: 12 } },
      { filePath: "api/clubs.ts", httpMethod: "POST", path: "/api/v2/clubs", testCoverage: { covered: 3, total: 12 } },
      { filePath: "api/players.ts", httpMethod: "GET", path: "/api/v2/players" },
    ]);
    expect([...set]).toEqual([routeCoverageKey({ filePath: "api/clubs.ts", httpMethod: "GET", path: "/api/v2/clubs" })]);
  });

  it("judges a function by the coverage report's own count", () => {
    const m = testCoverageOf({
      files: [{ file: "src/match.ts", total: 6, covered: 3, uncovered: "5-7", functions: [{ name: "Match.play", line: 4, endLine: 8, total: 3, covered: 0 }, { name: "table", line: 10, endLine: 14, total: 3, covered: 3 }] }],
    });
    expect(untestedFunction(m, "src/match.ts", "Match.play", 4)).toBe(true);
    expect(untestedFunction(m, "src/match.ts", "play", 6)).toBe(true);
    expect(untestedFunction(m, "src/match.ts", "table", 10)).toBe(false);
    expect(untestedFunction(m, "src/other.ts", "play", 4)).toBe(false);
  });
});
