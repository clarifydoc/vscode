import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { commonParent, findSplitTiers, type RouteLinker, type TierFolder } from "./splitTiers";

const reader = path.resolve(__dirname, "../clarifydoc/dist/index.js");
const available = fs.existsSync(reader);

async function linker(): Promise<RouteLinker> {
  const m = await import(pathToFileURL(reader).href);
  return (calls, routes) => m.linkApiCallsToRoutesDetailed(calls, routes);
}

const web: TierFolder = {
  name: "web",
  root: "/src/shop/web",
  misses: [
    { file: "src/api.ts", line: 4, method: "GET", url: "/api/orders/{}", reason: "unmatched" },
    { file: "src/api.ts", line: 9, method: "POST", url: "/api/orders", reason: "unmatched" },
    { file: "src/api.ts", line: 14, method: null, url: "/api/nowhere", reason: "unmatched" },
    // A refused method is a fact about this folder's own routes, not a sign of a split.
    { file: "src/api.ts", line: 20, method: "PUT", url: "/api/local", reason: "method-mismatch" },
  ],
  routes: [],
};
const api: TierFolder = {
  name: "api",
  root: "/src/shop/api",
  misses: [],
  routes: [
    { httpMethod: "GET", path: "/api/orders/:id", filePath: "routes/orders.js", line: 3, kind: "api" },
    { httpMethod: "POST", path: "/api/orders", filePath: "routes/orders.js", line: 8, kind: "api" },
    { httpMethod: "PUT", path: "/api/local", filePath: "routes/local.js", line: 2, kind: "api" },
  ],
};

describe.skipIf(!available)("findSplitTiers", () => {
  it("finds the calls one folder could not place that another folder's routes serve", async () => {
    const found = findSplitTiers([web, api], await linker());
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ caller: "web", server: "api", calls: 2 });
    expect(found[0]!.examples.join("\n")).toContain("/api/orders/:id");
  });

  it("joins by method: a GET call does not reach a POST-only route", async () => {
    const getOnly: TierFolder = { ...web, misses: [{ file: "a.ts", line: 1, method: "GET", url: "/api/orders", reason: "unmatched" }] };
    const postOnly: TierFolder = { ...api, routes: [api.routes[1]!] };
    expect(findSplitTiers([getOnly, postOnly], await linker())).toEqual([]);
  });

  it("skips a folder nested in the other — it is already inside that analysis", async () => {
    expect(findSplitTiers([web, { ...api, root: "/src/shop/web/server" }], await linker())).toEqual([]);
  });
});

describe("commonParent", () => {
  it("is the nearest directory holding every folder", () => {
    expect(commonParent(["/src/shop/web", "/src/shop/api"], "/home/me")).toBe("/src/shop");
    expect(commonParent(["/src/shop/apps/web", "/src/shop/api"], "/home/me")).toBe("/src/shop");
  });

  it("refuses the filesystem root and the home directory", () => {
    expect(commonParent(["/src/web", "/opt/api"], "/home/me")).toBeUndefined();
    expect(commonParent(["/home/me/web", "/home/me/api"], "/home/me")).toBeUndefined();
  });
});
