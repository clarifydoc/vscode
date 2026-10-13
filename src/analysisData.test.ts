import { describe, expect, it } from "vitest";
import * as fs from "fs";
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
    // sample-frontend: an API service imports a page (services → ui).
    const a = await load("sample-frontend");
    expect(a.layerViolations.length).toBeGreaterThan(0);
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
