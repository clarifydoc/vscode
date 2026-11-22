import { describe, expect, it, vi } from "vitest";
import { SummaryTreeProvider, missReason } from "./treeView";
import type { ResolvedAnalysis } from "./analysisData";

const folder = { uri: { fsPath: "/ws" }, name: "ws", index: 0 } as never;

function analysis(): ResolvedAnalysis {
  return {
    routes: [
      { httpMethod: "GET", path: "/bills/download", filePath: "api/bills.ts", line: 12 },
      { httpMethod: "GET", path: "/bills", filePath: "api/bills.ts", line: 4 },
    ],
    crossTier: {
      byFile: new Map(),
      screensByFile: new Map(),
      flowsByEntryFile: new Map(),
      missesByFile: new Map([
        ["web/api.ts", [
          { file: "web/api.ts", line: 30, method: "GET", url: "/bills/export", reason: "unmatched" },
          { file: "web/api.ts", line: 9, method: "PUT", url: "/bills", reason: "method-mismatch" },
        ]],
      ]),
      uncalled: new Set(["api/bills.ts:12"]),
      uncalledCount: 3,
    },
  } as unknown as ResolvedAnalysis;
}

describe("API gaps in the sidebar", () => {
  it("lists calls that reach no route, with why, and the routes no call reaches", () => {
    const g = (new SummaryTreeProvider({} as never) as any).apiGapsGroup(folder, analysis());
    expect([g.label, g.description]).toEqual(["API gaps", "5"]);
    const [calls, routes] = g.children;
    expect([calls.label, calls.description]).toEqual(["Calls that reach no route", "2"]);
    expect(calls.children.map((c: any) => [c.label, c.description, c.tooltip.split("\n")[0]])).toEqual([
      ["PUT /bills", "web/api.ts:9", "A route serves this path, but for another method."],
      ["GET /bills/export", "web/api.ts:30", "No route serves this path."],
    ]);
    // The listed routes are capped; the count is the analysis's exact one.
    expect([routes.label, routes.description, routes.children.map((c: any) => c.label)]).toEqual(["Routes no call reaches", "3", ["GET /bills/download"]]);
  });

  it("is absent when every call meets a route", () => {
    const a = analysis();
    a.crossTier.missesByFile.clear();
    a.crossTier.uncalled.clear();
    expect((new SummaryTreeProvider({} as never) as any).apiGapsGroup(folder, a)).toBeNull();
    expect(missReason("origin-mismatch")).toMatch(/service/);
  });
});

describe("the sidebar's top level from the head file", () => {
  const head = {
    frameworks: [{ name: "Express" }],
    health: { score: 81, grade: "B" },
    counts: { files: 40, routes: 12, links: 0, traces: 0, screens: 5, apiCalls: 0, entities: 0, security: 3, suggestions: 0, subProjects: 2, layerViolations: 0, duplicates: 0 },
  };

  async function provider(opts: { head?: unknown; done?: boolean }) {
    const loadAnalysis = vi.fn(async () => ({
      routes: [{ httpMethod: "GET", path: "/api/v2/clubs", filePath: "api/clubs.ts", line: 3 }],
      screens: [], security: [], hotspots: [], subProjects: [], frameworks: [{ name: "Express" }], health: { score: 81, grade: "B" }, healthSections: [],
      crossTier: { missesByFile: new Map(), uncalled: new Set() },
      tables: [], dataFlows: [],
    }));
    vi.doMock("./analysisData", () => ({
      fullLoadDone: () => !!opts.done,
      loadHead: async () => opts.head,
      loadAnalysis,
      onFullLoad: () => ({ dispose() {} }),
    }));
    vi.doMock("./bookmarks", () => ({ bookmarksOf: () => [] }));
    vi.doMock("./dataTables", () => ({ tableUses: () => [], describeTable: () => "" }));
    vi.resetModules();
    const { SummaryTreeProvider } = await import("./treeView.js");
    const p = new SummaryTreeProvider({ isRunning: () => false, context: { subscriptions: [] } } as never);
    return { p: p as any, loadAnalysis };
  }

  it("draws the groups the head sizes without loading the whole summary", async () => {
    const { p, loadAnalysis } = await provider({ head });
    const top = await p.folderChildren(folder);
    expect(top.map((n: any) => [n.label, n.description])).toEqual([
      ["Health: B", "81/100"], ["Routes", "12"], ["Screens", "5"], ["Security", "3"], ["Sub-projects", "2"], ["Frameworks", "1"],
    ]);
    expect(loadAnalysis).not.toHaveBeenCalled();
  });

  it("starts the whole load only when a group is expanded", async () => {
    const { p, loadAnalysis } = await provider({ head });
    const routes = (await p.folderChildren(folder)).find((n: any) => n.label === "Routes");
    expect(loadAnalysis).not.toHaveBeenCalled();
    const rows = await p.getChildren(routes);
    expect(loadAnalysis).toHaveBeenCalledTimes(1);
    expect(rows.map((r: any) => r.label)).toEqual(["GET /api/v2/clubs"]);
  });

  it("keeps the same id for a group before and after the whole summary arrives", async () => {
    const { p, loadAnalysis } = await provider({ head });
    const before = (await p.folderChildren(folder)).find((n: any) => n.label === "Routes");
    const full = await p.groups(folder, await loadAnalysis());
    expect(full.find((n: any) => n.label === "Routes").id).toBe(before.id);
  });

  it("loads the whole summary when there is no trusted head, as before", async () => {
    const { p, loadAnalysis } = await provider({ head: undefined });
    await p.folderChildren(folder);
    expect(loadAnalysis).toHaveBeenCalledTimes(1);
  });

  it("reads the whole summary once it is loaded", async () => {
    const { p, loadAnalysis } = await provider({ head, done: true });
    const top = await p.folderChildren(folder);
    expect(loadAnalysis).toHaveBeenCalledTimes(1);
    expect(top.some((n: any) => n.label === "Complexity hotspots")).toBe(true);
  });
});
