import { describe, expect, it } from "vitest";
import { ImpactResult, impactNodes } from "./impactModel";

const base: ImpactResult = {
  baseLabel: "HEAD",
  changedFiles: ["Application/Owners/GetOwnersQuery.cs"],
  unknownFiles: [],
  screens: [],
  screenCount: 0,
  routes: [{ method: "GET", path: "/Owners", file: "Api/Controllers/OwnersController.cs", line: 15 }],
  routeCount: 1,
  entities: ["Owner"],
  entityCount: 1,
  queues: [],
  queueCount: 0,
  truncated: false,
  tests: [],
  testCount: 0,
  chains: [{ path: ["Application/Owners/GetOwnersQuery.cs", "Api/Controllers/OwnersController.cs"], endsAt: "route" }],
  risk: { level: "moderate", reasons: ["affects 1 API route(s)"] },
};

describe("impactNodes", () => {
  it("puts the risk first, then only the sections with something in them", () => {
    expect(impactNodes(base).map((n) => n.label)).toEqual(["Risk: moderate", "API routes", "Data", "Changed files"]);
  });

  it("links routes to their line and shows each change's path to a route", () => {
    const nodes = impactNodes(base);
    expect(nodes[1].children![0]).toMatchObject({ label: "GET /Owners", file: "Api/Controllers/OwnersController.cs", line: 15 });
    const changed = nodes.find((n) => n.label === "Changed files")!.children![0];
    expect(changed.children!.map((c) => c.label)).toEqual(["Api/Controllers/OwnersController.cs"]);
  });

  it("marks counts as lower bounds when the analyzer capped them", () => {
    expect(impactNodes({ ...base, truncated: true })[1].description).toBe("1+");
  });

  it("lists what usually changes with the change, and who to ask", () => {
    const nodes = impactNodes({
      ...base,
      missingCoChanges: [
        { file: "Application/Owners/OwnerDto.cs", with: "Application/Owners/GetOwnersQuery.cs", count: 6, score: 0.8 },
        { file: "noise.cs", with: "x.cs", count: 3, score: 0.3, hidden: true },
      ],
      owners: [{ owner: "@acme/owners-team", files: 1 }],
      reviewers: [{ name: "Ada", files: 1, commits: 9 }],
    });
    expect(nodes.map((n) => n.label)).toEqual(["Risk: moderate", "API routes", "Data", "Usually changed with", "Reviewers", "Changed files"]);
    expect(nodes[3].children).toEqual([{ label: "Application/Owners/OwnerDto.cs", description: "with Application/Owners/GetOwnersQuery.cs · 6×", icon: "cochange", file: "Application/Owners/OwnerDto.cs" }]);
    expect(nodes[4].children!.map((c) => `${c.label} — ${c.description}`)).toEqual([
      "@acme/owners-team — owns 1 changed file (CODEOWNERS)",
      "Ada — 9 commits to 1 of these files",
    ]);
  });

  it("says so when nothing changed", () => {
    expect(impactNodes({ ...base, changedFiles: [] }).map((n) => n.label)).toEqual(["No changes against the last commit"]);
  });
});
