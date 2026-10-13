import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { indexProject, ResolvedAnalysis } from "./analysisData";
import {
  callersOf,
  describeRoute,
  isUncalled,
  linksAtLine,
  missesAtLine,
  navigableLinks,
  routeData,
  screensReaching,
  urlRange,
} from "./crossTier";

const reader = path.resolve(__dirname, "../clarifydoc/dist/index.js");
const fixtures = path.resolve(__dirname, "../../test-output");
const available = fs.existsSync(reader) && fs.existsSync(fixtures);

async function load(fixture: string): Promise<ResolvedAnalysis> {
  const analyzer = await import(pathToFileURL(reader).href);
  return indexProject(await analyzer.loadReportSummary(path.join(fixtures, fixture)), analyzer.buildIndex);
}

function route(a: ResolvedAnalysis, file: string, line: number) {
  const r = a.byFile.get(file)?.routes.find((x) => x.line === line);
  if (!r) throw new Error(`no route at ${file}:${line}`);
  return r;
}

describe("urlRange", () => {
  it("finds the URL as written, without the client's base", () => {
    const line = '  const res = await apiClient.get("/owners");';
    const r = urlRange(line, ["/api/owners"]);
    expect(line.slice(r!.start, r!.end)).toBe("/owners");
  });

  it("stops at the first hole of a template URL", () => {
    const line = "  const res = await apiClient.get(`/owners/${id}`);";
    const r = urlRange(line, ["/api/owners/${id}"]);
    expect(line.slice(r!.start, r!.end)).toBe("/owners/${id}");
  });

  it("is undefined when the URL is built elsewhere", () => {
    expect(urlRange("    return this.http.get<Tag>(this.getResourceUrl(id));", ["/api/tags/{}/"])).toBeUndefined();
  });
});

// Labels below are read from the fixture sources in test-fixtures/, not from
// the analyzer's output: web/src/api/owners.ts and Api/Controllers/OwnersController.cs.
describe.skipIf(!available)("cross-tier joins: sample-fullstack-cqrs", () => {
  const client = "web/src/api/owners.ts";
  const controller = "Api/Controllers/OwnersController.cs";

  it("joins each client call to the controller action that serves it", async () => {
    const a = await load("sample-fullstack-cqrs");
    const facts = a.byFile.get(client)!;
    const at = (line: number) => navigableLinks(linksAtLine(facts, line)).map((l) => `${l.target}:${l.targetLine}`);
    expect(at(15)).toEqual([`${controller}:15`]); // GET /owners → GetAll
    expect(at(20)).toEqual([`${controller}:19`]); // GET /owners/{id} → GetById
    expect(at(25)).toEqual([`${controller}:27`]); // POST /owners → Create
    expect(at(16)).toEqual([]);
  });

  it("lists each route's caller, and what it reads or writes", async () => {
    const a = await load("sample-fullstack-cqrs");
    const facts = a.byFile.get(controller)!;
    const getAll = route(a, controller, 15);
    const create = route(a, controller, 27);
    expect(callersOf(facts, getAll).map((l) => `${l.source}:${l.sourceLine}`)).toEqual([`${client}:15`]);
    expect(callersOf(facts, create).map((l) => `${l.source}:${l.sourceLine}`)).toEqual([`${client}:25`]);
    // GetOwnersQueryHandler reads _db.Owners; CreateOwnerCommandHandler adds to it.
    expect(routeData(a.crossTier, getAll).reads).toEqual(["Owner"]);
    expect(routeData(a.crossTier, getAll).writes).toEqual([]);
    expect(routeData(a.crossTier, create).writes).toEqual(["Owner"]);
    expect(describeRoute(1, [], routeData(a.crossTier, create), false)).toBe("1 caller · writes Owner");
  });
});

// test-fixtures/sample-angular: server/api.ts declares five Express routes;
// services/tag.service.ts calls four of them; services/user.service.ts fetches
// /api/users, which nothing serves; POST /:slug/duplicate has no caller.
describe.skipIf(!available)("cross-tier joins: sample-angular", () => {
  it("joins calls whose URL is built by a helper", async () => {
    const a = await load("sample-angular");
    const facts = a.byFile.get("src/app/services/tag.service.ts")!;
    const at = (line: number) => navigableLinks(linksAtLine(facts, line)).map((l) => `${l.target}:${l.targetLine}`);
    expect(at(12)).toEqual(["server/api.ts:5"]);
    expect(at(16)).toEqual(["server/api.ts:6"]);
    expect(at(20)).toEqual(["server/api.ts:7"]);
    expect(at(25)).toEqual(["server/api.ts:8"]);
  });

  it("says why a call reached no route", async () => {
    const a = await load("sample-angular");
    const facts = a.byFile.get("src/app/services/user.service.ts")!;
    expect(linksAtLine(facts, 7)).toEqual([]);
    expect(missesAtLine(a.crossTier, "src/app/services/user.service.ts", 7).map((m) => m.url)).toEqual(["/api/users"]);
  });

  it("marks the route nothing calls, and only that one", async () => {
    const a = await load("sample-angular");
    expect(isUncalled(a.crossTier, route(a, "server/api.ts", 10))).toBe(true);
    for (const line of [5, 6, 7, 8]) expect(isUncalled(a.crossTier, route(a, "server/api.ts", line))).toBe(false);
  });

  it("finds no screen above a service no component uses", async () => {
    const a = await load("sample-angular");
    const facts = a.byFile.get("server/api.ts")!;
    expect(screensReaching(a.crossTier, callersOf(facts, route(a, "server/api.ts", 5)))).toEqual([]);
  });
});

// test-fixtures/sample-react/frontend: components/ProductList.tsx fetches
// products in an effect (fetchProducts) and deletes in handleDelete
// (deleteProduct); pages/ProductsPage.tsx creates in handleSubmit
// (createProduct); api/client.ts makes the calls; backend/src/routes/products.ts
// serves them.
describe.skipIf(!available)("cross-tier joins: screens in sample-react", () => {
  // Read without lsp-enhancement.json: the fixture's copy predates the
  // route→call links, and the pinned analyzedAt keeps the age guard from
  // setting it aside.
  async function loadUnmerged(fixture: string): Promise<ResolvedAnalysis> {
    const analyzer = await import(pathToFileURL(reader).href);
    const raw = JSON.parse(fs.readFileSync(path.join(fixtures, fixture, "project-summary.json"), "utf8"));
    return indexProject(analyzer.denormalizeProject(raw), analyzer.buildIndex);
  }

  const routes = "backend/src/routes/products.ts";
  const screensOf = (a: ResolvedAnalysis, line: number) =>
    screensReaching(a.crossTier, callersOf(a.byFile.get(routes)!, route(a, routes, line)))
      .map((s) => s.title)
      .sort();

  it("names the nearest screen above each call", async () => {
    const a = await loadUnmerged("sample-react");
    expect(screensOf(a, 11)).toEqual(["ProductList"]); // GET /api/products
    expect(screensOf(a, 22)).toEqual(["ProductsPage"]); // POST /api/products
    expect(screensOf(a, 31)).toEqual(["ProductList"]); // DELETE /api/products/:id
  });

  it("does not credit the app shell above the nearest screen", async () => {
    const a = await loadUnmerged("sample-react");
    for (const line of [11, 22, 31]) expect(screensOf(a, line)).not.toContain("App");
  });
});
