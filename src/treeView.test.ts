import { describe, expect, it } from "vitest";
import { SummaryTreeProvider, missReason } from "./treeView";
import type { ResolvedAnalysis } from "./analysisData";

const folder = { uri: { fsPath: "/ws" }, name: "ws", index: 0 } as never;

function analysis(): ResolvedAnalysis {
  return {
    routes: [
      { httpMethod: "GET", path: "/invoices/download", filePath: "api/invoices.ts", line: 12 },
      { httpMethod: "GET", path: "/invoices", filePath: "api/invoices.ts", line: 4 },
    ],
    crossTier: {
      byFile: new Map(),
      screensByFile: new Map(),
      flowsByEntryFile: new Map(),
      missesByFile: new Map([
        ["web/api.ts", [
          { file: "web/api.ts", line: 30, method: "GET", url: "/invoices/export", reason: "unmatched" },
          { file: "web/api.ts", line: 9, method: "PUT", url: "/invoices", reason: "method-mismatch" },
        ]],
      ]),
      uncalled: new Set(["api/invoices.ts:12"]),
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
      ["PUT /invoices", "web/api.ts:9", "A route serves this path, but for another method."],
      ["GET /invoices/export", "web/api.ts:30", "No route serves this path."],
    ]);
    // The listed routes are capped; the count is the analysis's exact one.
    expect([routes.label, routes.description, routes.children.map((c: any) => c.label)]).toEqual(["Routes no call reaches", "3", ["GET /invoices/download"]]);
  });

  it("is absent when every call meets a route", () => {
    const a = analysis();
    a.crossTier.missesByFile.clear();
    a.crossTier.uncalled.clear();
    expect((new SummaryTreeProvider({} as never) as any).apiGapsGroup(folder, a)).toBeNull();
    expect(missReason("origin-mismatch")).toMatch(/service/);
  });
});
