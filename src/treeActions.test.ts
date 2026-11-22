import { describe, expect, it } from "vitest";
import { alreadySuppressed, fullRoute, reachingRoutes } from "./treeActions";

const routes = [
  { httpMethod: "GET", path: "/clubs", filePath: "api/clubs.ts", line: 4, auth: { anonymous: true } },
  { httpMethod: "POST", path: "/clubs", filePath: "api/clubs.ts", line: 20 },
];

describe("tree item action logic", () => {
  it("finds the routes a finding is reached from", () => {
    const hit = reachingRoutes(routes, { entries: [{ route: "POST /clubs", file: "api/clubs.ts", distance: 1, confidence: "EXTRACTED" }, { route: "GET /x", file: "z.ts", distance: 2, confidence: "INFERRED" }] });
    expect(hit.map((r) => r.line)).toEqual([20]);
    expect(reachingRoutes(routes, {})).toEqual([]);
  });

  it("takes the summary row behind a lens's route", () => {
    expect(fullRoute(routes, { httpMethod: "GET", path: "/clubs", filePath: "api/clubs.ts", line: 4 }).auth).toEqual({ anonymous: true });
  });

  it("does not suppress twice", () => {
    expect(alreadySuppressed(["// clarifydoc-ignore-next-line", "x"], 1)).toBe(true);
    expect(alreadySuppressed(["x", "y"], 1)).toBe(false);
    expect(alreadySuppressed(["x"], 0)).toBe(false);
  });
});
