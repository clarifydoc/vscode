import { describe, expect, it } from "vitest";
import { matchRows, SymbolRow } from "./symbolSearch";

const row = (name: string, container = "x.ts"): SymbolRow => ({ kind: "api-route", name, container, file: "x.ts", line: 1 });

describe("matchRows", () => {
  const rows = [row("GET /api/cars"), row("POST /api/cars"), row("GET /api/players", "cars-adjacent.ts"), row("Car", "Prisma")];

  it("needs every term, in name or container, ignoring case", () => {
    expect(matchRows(rows, "get cars", 10).map((r) => r.name)).toEqual(["GET /api/cars", "GET /api/players"]);
  });

  it("ranks name matches before container-only matches", () => {
    expect(matchRows(rows, "cars", 10).map((r) => r.name)[2]).toBe("GET /api/players");
  });

  it("caps the list", () => {
    expect(matchRows(rows, "", 2)).toHaveLength(2);
  });
});
