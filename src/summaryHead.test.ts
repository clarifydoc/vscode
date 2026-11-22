import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, utimes, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { headlineFrom, readTrustedHead } from "./summaryHead";
import type { AnalysisSummary } from "./summary";

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

const COUNTS = { files: 40, routes: 12, links: 90, traces: 300, screens: 5, apiCalls: 20, entities: 7, security: 3, suggestions: 2, subProjects: 2, layerViolations: 0, duplicates: 1 };
const HEAD = {
  schemaVersion: 1,
  projectRoot: "/league",
  analyzedAt: "2026-11-22T10:00:00.000Z",
  frameworks: [{ name: "Express", confidence: "high" }],
  health: { score: 81, grade: "B" },
  counts: COUNTS,
};
const FULL: AnalysisSummary = { frameworks: [], counts: { ...COUNTS, routes: 99 } };

const at = (seconds: number) => new Date(1_700_000_000_000 + seconds * 1000);

/** A results directory with a summary at t=100 s and a head at `headAt` (undefined: none). */
async function results(headAt: number | undefined, headText: string = JSON.stringify(HEAD)) {
  const dir = await mkdtemp(join(tmpdir(), "head-"));
  dirs.push(dir);
  const summary = join(dir, "project-summary.json");
  await writeFile(summary, "{}");
  await utimes(summary, at(100), at(100));
  if (headAt !== undefined) {
    await writeFile(join(dir, "summary-head.json"), headText);
    await utimes(join(dir, "summary-head.json"), at(headAt), at(headAt));
  }
  return { dir, summary };
}

describe("the headline from summary-head.json", () => {
  it("is read from the head, and the full summary is not loaded", async () => {
    const { summary } = await results(101);
    const full = vi.fn(async () => FULL);
    const s = await headlineFrom(summary, full);
    expect(s?.counts.routes).toBe(12);
    expect(s?.health).toEqual({ score: 81, grade: "B" });
    expect(s?.frameworks.map((f) => f.name)).toEqual(["Express"]);
    expect(full).not.toHaveBeenCalled();
  });

  it("is trusted when written in the same instant as the summary", async () => {
    const { summary } = await results(100);
    expect(await readTrustedHead(summary)).toBeDefined();
  });

  it("falls back to the full load when there is no head", async () => {
    const { summary } = await results(undefined);
    const full = vi.fn(async () => FULL);
    expect(await headlineFrom(summary, full)).toBe(FULL);
    expect(full).toHaveBeenCalledTimes(1);
  });

  it("falls back when the head is older than the summary", async () => {
    const { summary } = await results(99);
    const full = vi.fn(async () => FULL);
    expect(await headlineFrom(summary, full)).toBe(FULL);
    expect(full).toHaveBeenCalledTimes(1);
  });

  it("falls back when the head is older than an lsp delta written beside the summary", async () => {
    const { dir, summary } = await results(101);
    await writeFile(join(dir, "lsp-enhancement.json"), "{}");
    await utimes(join(dir, "lsp-enhancement.json"), at(150), at(150));
    expect(await readTrustedHead(summary)).toBeUndefined();
  });

  it.each([
    ["cut off mid-write", JSON.stringify(HEAD).slice(0, 40)],
    ["empty", ""],
    ["of another schema", JSON.stringify({ ...HEAD, schemaVersion: 2 })],
    ["without a count", JSON.stringify({ ...HEAD, counts: { files: 1 } })],
  ])("falls back when the head is %s", async (_why, text) => {
    const { summary } = await results(101, text);
    const full = vi.fn(async () => FULL);
    expect(await headlineFrom(summary, full)).toBe(FULL);
    expect(full).toHaveBeenCalledTimes(1);
  });

  it("is absent with no summary at all", async () => {
    const { dir } = await results(101);
    const full = vi.fn(async () => undefined);
    expect(await headlineFrom(join(dir, "missing.json"), full)).toBeUndefined();
    expect(full).toHaveBeenCalledTimes(1);
  });
});
