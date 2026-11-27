import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { indexProject } from "./analysisData";

// The bundled analyzer (`npm run bundle`) and the monorepo's fixture outputs.
// Both are absent in a bare checkout of the extension; the test then skips.
const reader = path.resolve(__dirname, "../clarifydoc/dist/index.js");
const fixtures = path.resolve(__dirname, "../../test-output");
const available = fs.existsSync(reader) && fs.existsSync(fixtures);

async function load(fixture: string) {
  const analyzer = await import(pathToFileURL(reader).href);
  return indexProject(await analyzer.loadReportSummary(path.join(fixtures, fixture)), analyzer.buildIndex);
}

describe.skipIf(!available)("indexProject on a real summary", () => {
  it("reads layer violations from the fields the analyzer writes", async () => {
    // The fixture's own violation was a router importing its pages, which the analyzer rightly no longer flags; a
    // copy of its summary carries one as the analyzer encodes it (file indexes), read back through the real loader.
    const summary = JSON.parse(fs.readFileSync(path.join(fixtures, "sample-frontend", "project-summary.json"), "utf8"));
    const index = (file: string) => summary.files.indexOf(file);
    summary.layerViolations = [
      { sourceFile: index("services/api.ts"), sourceLayer: "services", targetFile: index("pages/LoginPage.vue"), targetLayer: "ui", importSpecifier: "LoginPage.vue", line: 2 },
    ];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "layer-"));
    fs.writeFileSync(path.join(dir, "project-summary.json"), JSON.stringify(summary));
    const analyzer = await import(pathToFileURL(reader).href);
    const a = indexProject(await analyzer.loadReportSummary(dir), analyzer.buildIndex);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(a.layerViolations.length).toBe(1);
    expect(a.layerViolations[0]!.sourceFile).toBe("services/api.ts");
    for (const v of a.layerViolations) {
      expect(typeof v.sourceFile).toBe("string");
      expect(v.line).toBeGreaterThan(0);
      expect(v.sourceLayer).toBeTruthy();
      expect(v.targetLayer).toBeTruthy();
    }
    expect(a.layerViolations).toContainEqual(
      expect.objectContaining({ sourceLayer: "services", targetLayer: "ui", importSpecifier: "LoginPage.vue" }),
    );
  });

  it("names screens and keeps their route", async () => {
    const a = await load("sample-frontend");
    expect(a.screens.length).toBeGreaterThan(0);
    const login = a.screens.find((s) => s.title === "LoginPage");
    expect(login).toBeDefined();
    expect(a.screens.some((s) => s.routePath)).toBe(true);
    for (const s of a.screens) expect(s.line).toBeUndefined();
  });

  it("indexes paths, not page ids", async () => {
    const a = await load("sample-frontend");
    for (const f of a.files) expect(typeof f).toBe("string");
    for (const r of a.routes) expect(typeof r.filePath).toBe("string");
  });
});

describe.skipIf(!available)("indexProject — who knows a file", () => {
  it("reads churn and matches CODEOWNERS through the analyzer", async () => {
    const analyzer = await import(pathToFileURL(reader).href);
    const p = await analyzer.loadReportSummary(path.join(fixtures, "sample-backend"));
    p.fileChurn = [{ file: "routes/players.ts", commits: 7, additions: 1, deletions: 1, lastTouched: "2026-10-01", authors: ["Ada"], authorCount: 1, authorShares: [{ name: "Ada", commits: 7 }], busFactor: 1 }];
    p.codeOwners = { file: ".github/CODEOWNERS", rules: [{ pattern: "*", owners: ["@acme/all"] }, { pattern: "routes/", owners: ["@acme/api"] }] };
    const a = indexProject(p, analyzer.buildIndex, analyzer);
    expect(a.history?.churn.get("routes/players.ts")).toMatchObject({ commits: 7, busFactor: 1 });
    expect(a.history?.ownersOf?.("routes/players.ts")).toEqual(["@acme/api"]);
    expect(a.history?.ownersOf?.("server.ts")).toEqual(["@acme/all"]);
  });
});
