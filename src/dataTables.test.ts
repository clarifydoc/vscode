import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { indexProject } from "./analysisData";
import { describeTable, tableUses } from "./dataTables";

const reader = path.resolve(__dirname, "../clarifydoc/dist/index.js");
const fixtures = path.resolve(__dirname, "../../test-output");
const available = fs.existsSync(reader) && fs.existsSync(fixtures);

// Labels read from test-fixtures/sample-backend: routes/players.ts and
// routes/auth.ts reach services/playerService.ts, whose Prisma calls on
// `prisma.player` read (findMany/findUnique) or write (create/update/delete).
describe.skipIf(!available)("tableUses: sample-backend", () => {
  it("lists the routes that write and read each table, writers first", async () => {
    const analyzer = await import(pathToFileURL(reader).href);
    const a = indexProject(await analyzer.loadReportSummary(path.join(fixtures, "sample-backend")), analyzer.buildIndex);
    const [player] = tableUses(a);
    expect(player!.resource).toBe("player");
    expect(player!.entries.filter((e) => e.writes).map((e) => e.label).sort()).toEqual([
      "DELETE /api/players/:id", "POST /api/auth/register", "POST /api/players", "PUT /api/players/:id",
    ]);
    expect(player!.entries.filter((e) => e.reads).map((e) => e.label).sort()).toEqual([
      "GET /api/auth/me", "GET /api/players", "GET /api/players/:id", "GET /api/reports/exports/players.csv", "GET /api/reports/summary", "POST /api/auth/login",
    ]);
    expect(player!.entries.every((e) => typeof e.line === "number")).toBe(true);
    expect(describeTable(player!)).toBe("written by 4 routes · read by 6 routes");
  });
});
