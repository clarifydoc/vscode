import { describe, expect, it } from "vitest";
import { matchRows, SymbolRow } from "./symbolSearch";

const row = (name: string, container = "x.ts"): SymbolRow => ({ kind: "api-route", name, container, file: "x.ts", line: 1 });

describe("matchRows", () => {
  const rows = [row("GET /api/orders"), row("POST /api/orders"), row("GET /api/users", "orders-adjacent.ts"), row("Order", "Prisma")];

  it("needs every term, in name or container, ignoring case", () => {
    expect(matchRows(rows, "get orders", 10).map((r) => r.name)).toEqual(["GET /api/orders", "GET /api/users"]);
  });

  it("ranks name matches before container-only matches", () => {
    expect(matchRows(rows, "orders", 10).map((r) => r.name)[2]).toBe("GET /api/users");
  });

  it("caps the list", () => {
    expect(matchRows(rows, "", 2)).toHaveLength(2);
  });
});
