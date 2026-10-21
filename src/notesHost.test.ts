import { describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { answerReportRequest } from "./notesHost";

// vi.mock is hoisted above the imports, so the folder it closes over must be too.
const { dir } = vi.hoisted(() => {
  const nodeFs = require("fs") as typeof import("fs");
  const nodeOs = require("os") as typeof import("os");
  const nodePath = require("path") as typeof import("path");
  return { dir: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "clarifydoc-notes-")) };
});
vi.mock("./paths", () => ({ outputBaseDir: () => dir }));
vi.mock("./analysisData", () => ({ loadAnalysis: async () => undefined }));
const state = { context: {} } as never;
const folder = { name: "shop", uri: { fsPath: "/ws/shop" } } as never;

describe("answerReportRequest", () => {
  it("adds, lists and deletes notes, keeping them in notes.json and notes.md", async () => {
    const added = await answerReportRequest(state, folder, { op: "notes.add", subject: "file:api/cars.js", text: "Owned by payments." });
    expect(added.result).toMatchObject({ subject: "file:api/cars.js", text: "Owned by payments." });
    const listed = await answerReportRequest(state, folder, { op: "notes.list" });
    expect(listed.result).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, "notes.md"), "utf8")).toContain("> Owned by payments.");
    await answerReportRequest(state, folder, { op: "notes.delete", id: (added.result as { id: string }).id });
    expect((await answerReportRequest(state, folder, { op: "notes.list" })).result).toEqual([]);
  });

  it("refuses what the page should not send", async () => {
    expect((await answerReportRequest(state, folder, { op: "notes.add", subject: "../../etc", text: "x" })).error).toMatch(/subject/);
    expect((await answerReportRequest(state, folder, { op: "fs.write" })).error).toMatch(/unknown request/);
  });

  it("loses no note when two arrive at once", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => answerReportRequest(state, folder, { op: "notes.add", subject: "entity:Car", text: `n${i}` })));
    expect((await answerReportRequest(state, folder, { op: "notes.list" })).result).toHaveLength(10);
  });
});
