import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { typeGraph, typeId } from "./typeGraph";

const reader = path.resolve(__dirname, "../clarifydoc/dist/index.js");
const fixtures = path.resolve(__dirname, "../../test-output");
const available = fs.existsSync(reader) && fs.existsSync(fixtures);

// test-fixtures/sample-csharp-api: ReportsController : BaseApiController
// (Controllers/), AuthService : IAuthService (Services/), TagsController :
// ResourceController<string>; every controller base is ASP.NET's ControllerBase.
describe.skipIf(!available)("typeGraph on sample-csharp-api", () => {
  async function graph() {
    const analyzer = await import(pathToFileURL(reader).href);
    return typeGraph((await analyzer.loadReportSummary(path.join(fixtures, "sample-csharp-api"))).classGraph);
  }
  const names = (edges: { node: { name: string } }[]) => edges.map((e) => e.node.name).sort();

  it("finds a project base class and its subclasses", async () => {
    const g = await graph();
    expect(names(g.supertypes(typeId("Controllers/ReportsController.cs", "ReportsController")))).toEqual(["BaseApiController"]);
    expect(names(g.subtypes(typeId("Controllers/BaseApiController.cs", "BaseApiController")))).toContain("ReportsController");
    expect(names(g.subtypes(typeId("Controllers/ResourceController.cs", "ResourceController")))).toContain("TagsController");
  });

  it("finds an interface's implementations", async () => {
    const g = await graph();
    expect(names(g.subtypes(typeId("Services/IAuthService.cs", "IAuthService")))).toEqual(["AuthService"]);
  });

  it("leaves out types from outside the project", async () => {
    const g = await graph();
    expect(names(g.supertypes(typeId("Controllers/AuthController.cs", "AuthController")))).toEqual([]);
  });
});
