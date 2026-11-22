import { describe, expect, it } from "vitest";
import { behaviourCandidates, parseSeqDiff, surfaceNode, type SurfaceDiff } from "./surfaceModel";

const diff: SurfaceDiff = {
  changes: [
    { kind: "route-moved", breaking: true, route: "GET /api/players/by-id/:id", file: "routes/players.ts", line: 14, reasons: ["was GET /api/players/:id"] },
    { kind: "guard-lost", breaking: false, risky: true, route: "DELETE /api/players/:id", file: "routes/players.ts", line: 39, reasons: ["no longer guarded by requireAdmin"] },
    { kind: "link-gained", breaking: false, route: "GET /api/cars", file: "web/a.ts", line: 3, reasons: ["GET /api/cars from web/a.ts now reaches this route"] },
  ],
  counts: { total: 3, breaking: 1, risky: 1, routesAdded: 0, routesRemoved: 0 },
};

describe("surfaceNode", () => {
  it("lists what the branch changes in the API surface, breaking first, each opening its file", () => {
    const n = surfaceNode(diff, "main");
    expect([n.label, n.description, n.icon, n.level]).toEqual(["API surface vs main", "1 breaking · 1 risky · 3 change(s)", "break", "high"]);
    expect(n.children!.map((c) => [c.label, c.icon, c.file, c.line])).toEqual([
      ["GET /api/players/by-id/:id", "break", "routes/players.ts", 14],
      ["DELETE /api/players/:id", "risk", "routes/players.ts", 39],
      ["GET /api/cars", "route", "web/a.ts", 3],
    ]);
    expect(n.children![1]!.description).toBe("guard lost · risky — no longer guarded by requireAdmin");
  });
  it("says so when nothing changed", () => {
    expect(surfaceNode({ changes: [], counts: { total: 0, breaking: 0, risky: 0, routesAdded: 0, routesRemoved: 0 } }, "v2")).toEqual({ label: "API surface vs v2", description: "no change", icon: "info" });
  });
});

describe("import cycles in the surface group", () => {
  const withCycles: SurfaceDiff = {
    changes: [],
    counts: { total: 2, breaking: 0, risky: 2, routesAdded: 0, routesRemoved: 0 },
    cycles: { introduced: [["club.ts", "player.ts"]], grown: [{ files: ["car.ts", "garage.ts", "match.ts"], added: ["match.ts"] }] },
  };
  it("shows each introduced and grown cycle as a risky row that opens the cycle's files", () => {
    const n = surfaceNode(withCycles, "main");
    expect(n.description).toBe("nothing breaking · 2 risky · 2 change(s)");
    expect(n.level).toBe("moderate");
    expect(n.children!.map((c) => [c.label, c.description, c.icon, c.level, c.file])).toEqual([
      ["import cycle: club.ts \u2194 player.ts", "new import cycle \u00b7 risky", "risk", "moderate", "club.ts"],
      ["import cycle: 3 files", "grown by match.ts \u00b7 risky", "risk", "moderate", "car.ts"],
    ]);
    expect(n.children![1]!.children!.map((c) => c.file)).toEqual(["car.ts", "garage.ts", "match.ts"]);
  });
  it("says two cycles merged when no file was added", () => {
    const n = surfaceNode({ ...withCycles, cycles: { introduced: [], grown: [{ files: ["a.ts", "b.ts"], added: [] }] } }, "main");
    expect(n.children![0]!.description).toBe("two cycles merged \u00b7 risky");
  });
});

describe("behaviour changed rows", () => {
  const d: SurfaceDiff = {
    changes: [
      { kind: "data-effect-changed", breaking: false, route: "GET /api/clubs", file: "routes/clubs.ts", line: 3, reasons: ["now reaches table clubs"] },
      { kind: "guard-lost", breaking: false, risky: true, route: "DELETE /api/clubs/:id", reasons: ["x"] },
      { kind: "route-added", breaking: false, route: "GET /api/cars", reasons: ["new"] },
    ],
    counts: { total: 3, breaking: 0, risky: 1, routesAdded: 1, routesRemoved: 0 },
  };
  it("qualifies routes the diff reports as changed in flow, then routes in touched files, capped", () => {
    const routes = [
      { route: "GET /api/clubs", file: "routes/clubs.ts" },
      { route: "POST /api/players", file: "routes/players.ts" },
      { route: "GET /api/matches", file: "routes/matches.ts" },
    ];
    expect(behaviourCandidates(d, ["routes/players.ts"], routes)).toEqual([
      { route: "GET /api/clubs", file: "routes/clubs.ts" },
      { route: "POST /api/players", file: "routes/players.ts" },
    ]);
    expect(behaviourCandidates(d, ["routes/players.ts"], routes, 1)).toHaveLength(1);
  });
  it("reads the step count of a sequence diff and nothing from an unchanged or new flow", () => {
    expect(parseSeqDiff("GET /api/clubs: 2 changes in the flow\n  + a\n  - b\n")).toBe(2);
    expect(parseSeqDiff("GET /api/clubs: 1 change in the flow\n")).toBe(1);
    expect(parseSeqDiff("GET /api/clubs: the flow is unchanged.\n")).toBeNull();
    expect(parseSeqDiff("GET /api/clubs: not in the base analysis (x) \u2014 the whole flow is new.\n")).toBeNull();
  });
  it("lists each as a row that opens the sequence diff, even when the surface itself is unchanged", () => {
    const empty: SurfaceDiff = { changes: [], counts: { total: 0, breaking: 0, risky: 0, routesAdded: 0, routesRemoved: 0 } };
    const n = surfaceNode(empty, "main", [{ route: "GET /api/clubs", file: "routes/clubs.ts", steps: 1 }], "folder-1");
    expect(n.children).toEqual([
      { label: "GET /api/clubs", description: "behaviour changed \u2014 1 step of the flow changed \u00b7 click for the sequence diff", icon: "route", command: { id: "clarifydoc.showSequenceDiff", title: "Show sequence diff", arguments: ["folder-1", "GET /api/clubs", "routes/clubs.ts"] } },
    ]);
  });
});

describe("mergeCodexToml", () => {
  it("adds ClarifyDoc's table, replaces an earlier one, and keeps the rest", async () => {
    const { mergeCodexToml } = await import("./mcpInstall.js");
    const entry = { command: "/bin/clarifydoc-mcp" };
    const first = mergeCodexToml('model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n', entry, "/repo");
    expect(first).toBe('model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n\n[mcp_servers.clarifydoc]\ncommand = "/bin/clarifydoc-mcp"\nargs = ["/repo"]\n');
    expect(mergeCodexToml(first, { command: "/new/clarifydoc-mcp", args: ["/repo", "--analysis-dir", "/s"] }, "/repo")).toBe('model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n\n[mcp_servers.clarifydoc]\ncommand = "/new/clarifydoc-mcp"\nargs = ["/repo","--analysis-dir","/s"]\n');
  });
});
