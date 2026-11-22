import { readFileSync } from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { SummaryTreeProvider } from "./treeView";
import type { ResolvedAnalysis } from "./analysisData";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8")) as {
  contributes: {
    commands: { command: string; title: string }[];
    menus: Record<string, { command?: string; when?: string }[]>;
    configuration: { properties: Record<string, { description?: string }> };
  };
};
const menu = (command: string) => pkg.contributes.menus["view/item/context"]!.filter((m) => m.command === command);
const matches = (when: string, item: string) => {
  const eq = /viewItem == (\S+)/.exec(when);
  if (eq) return eq[1] === item;
  const re = /viewItem =~ \/(.+)\//.exec(when);
  return !!re && new RegExp(re[1]!.replace(/\\\\/g, "\\")).test(item);
};

describe("sidebar item actions contributions", () => {
  it("offers route actions on routes only and finding actions on findings only", () => {
    for (const c of ["treeItemFindCallers", "treeItemShowRoute", "tryItRoute", "copyRouteAsCurl"]) {
      const m = menu(`clarifydoc.${c}`);
      expect(m.length, c).toBeGreaterThan(0);
      expect(m.every((x) => matches(x.when!, "clarifydoc.route") && !matches(x.when!, "clarifydoc.finding")), c).toBe(true);
    }
    for (const c of ["treeItemSuppress", "treeItemReachingRoutes"]) {
      const m = menu(`clarifydoc.${c}`);
      expect(m.length, c).toBeGreaterThan(0);
      expect(m.every((x) => matches(x.when!, "clarifydoc.finding") && !matches(x.when!, "clarifydoc.route")), c).toBe(true);
    }
  });

  it("keeps copy, traces and blast radius on routes and findings", () => {
    for (const c of ["copyTreeItem", "treeItemTraces", "treeItemBlast"]) {
      expect(menu(`clarifydoc.${c}`).some((x) => matches(x.when!, "clarifydoc.route") && matches(x.when!, "clarifydoc.finding")), c).toBe(true);
    }
  });

  it("declares every command with a title, hidden from the palette, and the lens setting with a description", () => {
    const ids = ["treeItemFindCallers", "treeItemShowRoute", "treeItemSuppress", "treeItemReachingRoutes", "tryItRoute", "copyRouteAsCurl"].map((c) => `clarifydoc.${c}`);
    for (const id of ids) {
      expect(pkg.contributes.commands.find((c) => c.command === id)?.title, id).toBeTruthy();
      expect(pkg.contributes.menus.commandPalette!.some((m) => m.command === id && m.when === "false"), id).toBe(true);
    }
    expect(pkg.contributes.configuration.properties["clarifydoc.codeLens.tryIt"]!.description).toBeTruthy();
  });
});

describe("tree item kinds and the new-findings badge", () => {
  const folder = { uri: { fsPath: "/ws" }, name: "ws", index: 0 } as never;
  const issue = (message: string) => ({ category: "sql-injection", severity: "high", message, filePath: "a.ts", line: 3 });
  const analysis = (security: unknown[]) => ({ routes: [{ httpMethod: "GET", path: "/clubs", filePath: "a.ts", line: 1 }], security }) as unknown as ResolvedAnalysis;

  it("marks routes and findings with their own context values, and badges what is new", () => {
    const p = new SummaryTreeProvider({} as never) as any;
    const badges: number[] = [];
    p.onDidChangeBadge((n: number) => badges.push(n));
    p.noteFindings(folder, analysis([issue("one")]));
    expect(p.newFindings).toBe(0);
    const second = analysis([issue("one"), issue("two")]);
    p.noteFindings(folder, second);
    expect(badges).toEqual([1]);

    const route = p.routesGroup(folder, second).children[0];
    expect([route.contextValue, route.route.path]).toEqual(["clarifydoc.route", "/clubs"]);
    const leaves = p.securityGroup(folder, second).children;
    expect(leaves.map((l: any) => [l.contextValue, l.description.endsWith("· new")])).toEqual([["clarifydoc.finding", false], ["clarifydoc.finding", true]]);
  });
});
