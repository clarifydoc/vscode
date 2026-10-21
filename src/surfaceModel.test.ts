import { describe, expect, it } from "vitest";
import { surfaceNode, type SurfaceDiff } from "./surfaceModel";

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

describe("mergeCodexToml", () => {
  it("adds ClarifyDoc's table, replaces an earlier one, and keeps the rest", async () => {
    const { mergeCodexToml } = await import("./mcpInstall.js");
    const entry = { command: "/bin/clarifydoc-mcp" };
    const first = mergeCodexToml('model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n', entry, "/repo");
    expect(first).toBe('model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n\n[mcp_servers.clarifydoc]\ncommand = "/bin/clarifydoc-mcp"\nargs = ["/repo"]\n');
    expect(mergeCodexToml(first, { command: "/new/clarifydoc-mcp", args: ["/repo", "--analysis-dir", "/s"] }, "/repo")).toBe('model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n\n[mcp_servers.clarifydoc]\ncommand = "/new/clarifydoc-mcp"\nargs = ["/repo","--analysis-dir","/s"]\n');
  });
});
