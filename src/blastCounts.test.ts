import { describe, expect, it } from "vitest";
import { blastCountsOf, blastPack, blastShows, blastTitle, PACK_PATHS } from "./blastCounts";

const rows = [
  { filePath: "src/club.ts", directDependents: 3, transitiveDependents: 4, affectedFiles: ["src/match.ts", "src/player.ts", "src/league.ts"], transitiveFiles: ["src/garage.ts"] },
  { filePath: "src/leaf.ts", directDependents: 0, transitiveDependents: 0, affectedFiles: [], transitiveFiles: [] },
  { filePath: 7 },
];

describe("blastCountsOf", () => {
  it("keeps counts and nearest paths, direct first, and drops files nothing depends on", () => {
    const m = blastCountsOf(rows);
    expect([...m.keys()]).toEqual(["src/club.ts"]);
    expect(m.get("src/club.ts")).toEqual({ direct: 3, transitive: 4, paths: ["src/match.ts", "src/player.ts", "src/league.ts", "src/garage.ts"] });
    expect(blastCountsOf(undefined).size).toBe(0);
  });
});

describe("the lens gate", () => {
  const b = blastCountsOf(rows).get("src/club.ts")!;
  it("shows at and above the threshold, not below, never at 0", () => {
    expect(blastShows(b, 3)).toBe(true);
    expect(blastShows(b, 2)).toBe(true);
    expect(blastShows(b, 4)).toBe(false);
    expect(blastShows(b, 0)).toBe(false);
    expect(blastShows(undefined, 1)).toBe(false);
  });
  it("states the count in words", () => {
    expect(blastTitle(b)).toBe("$(flame) a change here reaches 7 files, 3 directly");
    expect(blastTitle({ direct: 1, transitive: 0, paths: [] })).toBe("$(flame) a change here reaches 1 file, 1 directly");
  });
});

describe("blastPack", () => {
  it("is plain text: the file, the count, the nearest dependents by path", () => {
    const b = blastCountsOf(rows).get("src/club.ts")!;
    expect(blastPack("src/club.ts", b)).toBe([
      "Before editing src/club.ts: a change here reaches 7 files (3 directly, 4 through them).",
      "Nearest dependents (4 of 7):",
      "- src/match.ts", "- src/player.ts", "- src/league.ts", "- src/garage.ts",
      "Check these still work after the change, and run their tests.",
    ].join("\n"));
  });
  it("caps the list and says when nothing depends on the file", () => {
    const paths = Array.from({ length: 40 }, (_, i) => `src/car${i}.ts`);
    const lines = blastPack("src/car.ts", { direct: 40, transitive: 0, paths }).split("\n");
    expect(lines.filter((l) => l.startsWith("- "))).toHaveLength(PACK_PATHS);
    expect(blastPack("src/leaf.ts", undefined)).toContain("no file that depends on it");
  });
});
