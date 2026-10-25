import { describe, expect, it } from "vitest";
import { ImpactResult, describeSignatureChange, impactNodes } from "./impactModel";

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

  it("leads with what breaks at the function level, then who to read", () => {
    const nodes = impactNodes({
      ...base,
      symbolImpact: {
        changed: [{ file: "Application/Owners/GetOwnersQuery.cs", symbol: "GetOwnersQuery.Handle", line: 12, endLine: 30 }],
        direct: [{ file: "Api/Controllers/OwnersController.cs", symbol: "OwnersController.GetAll", line: 15, depth: 1, confidence: "EXTRACTED" }],
        transitive: [{ file: "web/src/api/owners.ts", symbol: "listOwners", line: 4, depth: 2, confidence: "INFERRED" }],
        routes: [{ route: "GET /Owners", file: "Api/Controllers/OwnersController.cs", line: 15, depth: 1, confidence: "EXTRACTED" }],
        reviewOnly: ["Application/Owners/OwnerDto.cs"],
        signatureChanges: [{ file: "Application/Owners/GetOwnersQuery.cs", symbol: "GetOwnersQuery.Handle", line: 12, kind: "arity", before: 1, after: 2, callers: 1, breaking: true }],
      },
    });
    expect(nodes.map((n) => n.label).slice(0, 5)).toEqual(["Risk: moderate", "Signature changes", "Will break — direct callers", "Likely affected", "Review — imports it, calls nothing changed"]);
    expect(nodes[1].children![0]).toMatchObject({ label: "GetOwnersQuery.Handle()", description: "1 → 2 required parameters · 1 caller · breaks them", icon: "break" });
    expect(nodes[2].children!.map((c) => c.label)).toEqual(["GET /Owners", "OwnersController.GetAll()"]);
    expect(nodes[3].children![0]!.description).toBe("web/src/api/owners.ts:4 · 2 hops · inferred");
    const changed = nodes.find((n) => n.label === "Changed files")!.children![0]!;
    expect(changed.children![0]).toMatchObject({ label: "GetOwnersQuery.Handle()", icon: "function", line: 12 });
  });

  it("says where each caller stands, and names a rename or a new return type", () => {
    const nodes = impactNodes({
      ...base,
      symbolImpact: {
        changed: [{ file: "svc.ts", symbol: "place", line: 1, endLine: 9 }],
        direct: [
          { file: "jobs.ts", symbol: "nightly", line: 3, depth: 1, confidence: "EXTRACTED", standing: "unverified" },
          { file: "routes.ts", symbol: "create", line: 7, depth: 1, confidence: "EXTRACTED", standing: "covered", coveredBy: { file: "routes.test.ts", symbol: "test_create" } },
        ],
        transitive: [],
        reviewOnly: [],
        signatureChanges: [
          { file: "svc.ts", symbol: "place", line: 1, kind: "removed", renamedTo: "placeCar", callers: 2, breaking: true },
          { file: "svc.ts", symbol: "find", line: 12, kind: "return-type", before: "Car | null", after: "Car", callers: 1, breaking: true },
        ],
      },
    });
    const sig = nodes.find((n) => n.label === "Signature changes")!.children!.map((c) => c.description);
    expect(sig).toEqual(["removed — possibly renamed to placeCar · 2 callers · breaks them", "returns Car, was Car | null · 1 caller · breaks them"]);
    const callers = nodes.find((n) => n.label === "Will break — direct callers")!.children!;
    expect(callers.map((c) => [c.description, c.icon])).toEqual([
      ["jobs.ts:3 · unverified", "unverified"],
      ["routes.ts:7 · covered by test_create", "caller"],
    ]);
  });

  it("words every signature-change kind the engine reports", () => {
    const nodes = impactNodes({
      ...base,
      symbolImpact: {
        changed: [],
        direct: [],
        transitive: [],
        reviewOnly: [],
        signatureChanges: [
          { file: "garage.ts", symbol: "parkCar", line: 4, kind: "moved", movedTo: "src/parking.ts", callers: 3, breaking: true },
          { file: "garage.ts", symbol: "findCar", line: 9, kind: "param-type", before: "id: string", after: "id: CarId", callers: 1, breaking: true },
          { file: "garage.ts", symbol: "washCar", line: 14, kind: "visibility", before: "exported", after: "private", callers: 2, breaking: false },
          { file: "garage.ts", symbol: "tuneCar", line: 20, kind: "arity", before: 1, after: 2, callers: 0, breaking: false },
        ],
      },
    });
    const sig = nodes.find((n) => n.label === "Signature changes")!.children!.map((c) => [c.description, c.icon]);
    expect(sig).toEqual([
      ["moved to src/parking.ts · 3 callers · breaks them", "break"],
      ["takes id: CarId, was id: string · 1 caller · breaks them", "break"],
      ["no longer exported or public · 2 callers", "function"],
      ["1 → 2 required parameters", "function"],
    ]);
    expect(sig.some(([d]) => String(d).includes("undefined"))).toBe(false);
  });

  it("names a signature-change kind it does not know instead of guessing", () => {
    expect(describeSignatureChange({ kind: "generic-arity", before: 1, after: 2 })).toBe("generic-arity: 1 → 2");
    expect(describeSignatureChange({ kind: "sealed" })).toBe("sealed");
    expect(describeSignatureChange({ kind: "moved" })).toBe("moved");
  });

  it("marks the callers the editor reports errors at", () => {
    const errors: Record<string, number[]> = { "jobs.ts": [3], "routes.ts": [40, 41] };
    const nodes = impactNodes(
      {
        ...base,
        symbolImpact: {
          changed: [{ file: "garage.ts", symbol: "parkCar", line: 1, endLine: 9 }],
          direct: [
            { file: "jobs.ts", symbol: "nightly", line: 3, depth: 1, confidence: "EXTRACTED", standing: "unverified" },
            { file: "routes.ts", symbol: "create", line: 7, depth: 1, confidence: "EXTRACTED" },
          ],
          transitive: [{ file: "fleet.ts", symbol: "refuel", line: 5, depth: 2, confidence: "EXTRACTED" }],
          routes: [{ route: "POST /cars", file: "jobs.ts", line: 3, depth: 2, confidence: "EXTRACTED" }],
          reviewOnly: [],
        },
      },
      (file) => errors[file],
    );
    const direct = nodes.find((n) => n.label === "Will break — direct callers")!;
    expect(direct.description).toBe("2 · 1 with errors");
    expect(direct.children!.map((c) => [c.description, c.icon])).toEqual([
      ["jobs.ts:3 · unverified · error at the call", "error"],
      ["routes.ts:7 · 2 errors in file", "caller"],
    ]);
    const further = nodes.find((n) => n.label === "Likely affected")!;
    expect(further.description).toBe("2 · 1 with errors");
    expect(further.children!.map((c) => [c.label, c.icon])).toEqual([
      ["POST /cars", "error"],
      ["refuel()", "caller"],
    ]);
  });

  it("says so when nothing changed", () => {
    expect(impactNodes({ ...base, changedFiles: [] }).map((n) => n.label)).toEqual(["No changes against the last commit"]);
  });
});
