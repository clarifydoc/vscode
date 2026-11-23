import { describe, expect, it } from "vitest";
import { allCuts, architectureCut, deadFactsOf, fileCut, symbolCut, type NeighbourhoodFacts } from "./neighbourhoodModes";
import type { GraphFile } from "./filesGraph";

// A small league: the club service imports the player and match services; the
// pages import the club service; a retired scoreboard imports nothing and is
// imported by nobody.
const facts = (): NeighbourhoodFacts => ({
  componentGraph: {
    "web/ClubPage.tsx": ["web/clubService.ts"],
    "web/LeaguePage.tsx": ["web/clubService.ts", "web/leagueService.ts"],
    "web/clubService.ts": ["web/playerService.ts", "web/matchService.ts"],
    "web/matchService.ts": ["web/playerService.ts"],
    "web/leagueService.ts": ["web/matchService.ts"],
  },
  communities: {
    "0": ["web/ClubPage.tsx", "web/LeaguePage.tsx"],
    "1": ["web/clubService.ts", "web/leagueService.ts"],
    "2": ["web/matchService.ts", "web/playerService.ts"],
  },
  communityNames: { "0": { name: "pages" }, "1": { name: "club" }, "2": { name: "match" } },
  fileProjects: {},
  subProjects: [{ id: "root", name: "(root)" }],
});
const dead = deadFactsOf({ files: [{ filePath: "web/oldScoreboard.ts" }], exports: [{ filePath: "web/clubService.ts" }, { filePath: "web/clubService.ts" }] });
const none = deadFactsOf(undefined);
const ids = (v: { nodes: Record<string, { file: string }> }) => Object.values(v.nodes).map((n) => n.file).sort();

describe("file cut", () => {
  it("draws the importers and the imports of the open file", () => {
    const cut = fileCut("web/clubService.ts", facts(), none);
    const v = cut.views[0]!;
    expect(ids(v)).toEqual(["web/ClubPage.tsx", "web/LeaguePage.tsx", "web/clubService.ts", "web/matchService.ts", "web/playerService.ts"]);
    expect(v.mermaid).toMatch(/i\d --> c/);
    expect(v.mermaid).toMatch(/c --> o\d/);
    expect(cut.note).toContain("2 importers · 2 imports");
  });

  it("names unused exports and unreachable files in words, not only dashes", () => {
    const f = facts();
    f.componentGraph["web/oldScoreboard.ts"] = ["web/clubService.ts"];
    const cut = fileCut("web/clubService.ts", f, dead);
    expect(cut.views[0]!.mermaid).toContain("2 unused exports");
    expect(cut.views[0]!.mermaid).toContain("(unreachable)");
    expect(cut.views[0]!.mermaid).toContain(":::dead");
  });

  it("caps each side and says so", () => {
    const f = facts();
    for (let i = 0; i < 8; i++) f.componentGraph[`web/Page${i}.tsx`] = ["web/clubService.ts"];
    const cut = fileCut("web/clubService.ts", f, none, { maxFiles: 3, maxUnits: 10 });
    expect(ids(cut.views[0]!).filter((x) => x.includes("Page")).length).toBe(3);
    expect(cut.views[0]!.mermaid).toContain("+7 more files");
    expect(cut.note).toContain("showing the 3 most connected");
  });

  it("says so when nothing is recorded", () => {
    expect(fileCut("web/ClubPage.tsx", { ...facts(), componentGraph: {} }, none).note).toContain("No imports");
  });
});

describe("architecture cut", () => {
  it("draws the unit of the file and the units on each side, with the import counts", () => {
    const cut = architectureCut("web/clubService.ts", facts(), none);
    const m = cut.views[0]!.mermaid;
    expect(m).toContain("club");
    expect(m).toContain("pages");
    expect(m).toContain("match");
    expect(m).toMatch(/i0\[.*pages.*\]/s);
    expect(m).toMatch(/u -->\|"3 imports"\| o0/); // club -> match: clubService→player, clubService→match, leagueService→match
    expect(cut.note).toBe("Imported by 1 unit · imports from 1 unit (counts are over all files of the unit).");
    expect(Object.keys(cut.views[0]!.nodes).sort()).toEqual(["i0", "o0", "u"]);
  });

  it("falls back to the folder for a file outside every community", () => {
    const f = facts();
    f.componentGraph["tools/seed.ts"] = ["web/clubService.ts"];
    const cut = architectureCut("tools/seed.ts", f, none);
    expect(cut.views[0]!.mermaid).toContain("tools/");
    expect(cut.views[0]!.mermaid).toContain("club");
  });

  it("caps the units and says so", () => {
    const f = facts();
    for (let i = 0; i < 6; i++) {
      f.componentGraph[`mod${i}/a.ts`] = ["web/clubService.ts"];
    }
    const cut = architectureCut("web/clubService.ts", f, none, { maxFiles: 15, maxUnits: 2 });
    expect(cut.views[0]!.mermaid).toContain("+5 more units");
    expect(cut.note).toContain("showing the 2 most connected");
  });

  it("marks a unit whose files are all unreachable", () => {
    const f = facts();
    f.componentGraph["web/oldScoreboard.ts"] = ["web/clubService.ts"];
    f.communities["3"] = ["web/oldScoreboard.ts"];
    f.communityNames["3"] = { name: "retired" };
    const m = architectureCut("web/clubService.ts", f, dead).views[0]!.mermaid;
    expect(m).toMatch(/retired\n\(unreachable\)/);
    expect(m).toContain(":::dead");
  });
});

describe("all cuts", () => {
  const input: GraphFile = {
    file: "web/clubService.ts",
    defs: [{ symbol: "loadClub", kind: "function", line: 3 }],
    outbound: [], inbound: [], callsRoutes: [], servesCalls: [], routes: [],
  };
  it("is symbol, file, architecture in that order, symbol keeping its two views", () => {
    const cuts = allCuts(input, facts(), none);
    expect(cuts.map((c) => c.id)).toEqual(["symbol", "file", "architecture"]);
    expect(cuts[0]!.views.map((v) => v.label)).toEqual(["Functions", "Files"]);
    expect(symbolCut(input).views[0]!.nodes).toBeDefined();
  });
  it("leaves the import cuts empty, with a reason, when the analysis has no import graph", () => {
    const cuts = allCuts(input, undefined, none);
    expect(cuts[1]!.views).toEqual([]);
    expect(cuts[2]!.note).toContain("no import graph");
  });
});
