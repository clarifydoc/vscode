import { beforeEach, describe, expect, it, vi } from "vitest";

// A hand-made `vscode` so the provider can run: configuration, one workspace folder, lenses as plain values.
const cfg = vi.hoisted(() => ({ values: {} as Record<string, unknown>, clipboard: "" }));
vi.mock("vscode", () => {
  class Range { constructor(readonly a: number, readonly b: number, readonly c: number, readonly d: number) {} get start() { return { line: this.a, character: this.b }; } }
  class CodeLens { constructor(readonly range: Range, readonly command?: { title: string; tooltip?: string; command: string; arguments?: unknown[] }) {} }
  class EventEmitter { event = () => ({ dispose() {} }); fire() {} dispose() {} }
  const uri = (p: string) => ({ fsPath: p, scheme: "file", toString: () => `file://${p}` });
  const folder = { name: "club", uri: uri("/ws/club") };
  return {
    Range, CodeLens, EventEmitter,
    Uri: { file: uri, parse: (s: string) => uri(s.replace("file://", "")) },
    workspace: {
      getConfiguration: () => ({ get: (k: string) => cfg.values[k] }),
      getWorkspaceFolder: () => folder,
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    window: { showInformationMessage: vi.fn(), setStatusBarMessage: vi.fn(), activeTextEditor: undefined },
    env: { clipboard: { writeText: async (t: string) => { cfg.clipboard = t; } } },
  };
});

const analysis = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("./analysisData", () => ({
  loadAnalysis: async () => analysis.value,
  loadFileIndex: async () => ({ defs: [] }),
  linkCommands: () => [],
  relPathOf: (_f: unknown, u: { fsPath: string }) => u.fsPath.replace("/ws/club/", ""),
  routeCoverageKey: () => "",
}));
vi.mock("./controlFlowSupport", () => ({ onDidChangeControlFlowSupport: () => ({ dispose() {} }), supportsControlFlow: () => false }));
vi.mock("./crossTier", () => ({}));
vi.mock("./apiCallProvider", () => ({}));
vi.mock("./docFacts", () => ({ crossTierEnabled: () => false }));

import * as vscode from "vscode";
import { ClarifyDocCodeLensProvider } from "./codeLens";
import { blastCountsOf } from "./blastCounts";
import { checkBlastBeforeEdit } from "./blastLens";

const state = { context: { subscriptions: [] }, onAnalysisChanged: () => ({ dispose() {} }), lines: {} } as never;
const blast = blastCountsOf([
  { filePath: "src/club.ts", directDependents: 60, transitiveDependents: 83, affectedFiles: ["src/match.ts"], transitiveFiles: [] },
  { filePath: "src/util.ts", directDependents: 3, transitiveDependents: 2, affectedFiles: [], transitiveFiles: [] },
  { filePath: "test/club.test.ts", directDependents: 90, transitiveDependents: 0, affectedFiles: [], transitiveFiles: [] },
]);
const doc = (rel: string) => ({ uri: vscode.Uri.file(`/ws/club/${rel}`) }) as vscode.TextDocument;
const lenses = async (rel: string) => (await new ClarifyDocCodeLensProvider(state).provideCodeLenses(doc(rel))).map((l) => l.command!);

beforeEach(() => {
  cfg.values = {};
  analysis.value = {
    byFile: new Map(["src/club.ts", "src/util.ts", "test/club.test.ts"].map((f) => [f, { routes: [] }])),
    risky: new Map(), blast, isTest: (f: string) => f.startsWith("test/"),
  };
});

describe("the file-top blast lens", () => {
  it("shows at or above the threshold, in words, and opens the Blast Radius", async () => {
    const found = await lenses("src/club.ts");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ title: "$(flame) a change here reaches 143 files, 60 directly", command: "clarifydoc.openReportForFile" });
    expect(found[0]!.arguments![1]).toBe("blast");
    expect(found[0]!.tooltip).toContain("Check Blast Before Edit");
    cfg.values["blastThreshold"] = 60;
    expect(await lenses("src/club.ts")).toHaveLength(1);
  });

  it("is absent below the threshold, at 0, when lenses are off and on a test file", async () => {
    expect(await lenses("src/util.ts")).toEqual([]);
    cfg.values["blastThreshold"] = 61;
    expect(await lenses("src/club.ts")).toEqual([]);
    cfg.values["blastThreshold"] = 0;
    expect(await lenses("src/club.ts")).toEqual([]);
    cfg.values = { blastThreshold: 1, enabled: false };
    expect(await lenses("src/club.ts")).toEqual([]);
    cfg.values = { blastThreshold: 1 };
    expect(await lenses("test/club.test.ts")).toEqual([]);
  });
});

describe("Check Blast Before Edit", () => {
  it("copies the pack for the file", async () => {
    await checkBlastBeforeEdit(state, vscode.Uri.file("/ws/club/src/club.ts"));
    expect(cfg.clipboard).toContain("Before editing src/club.ts: a change here reaches 143 files (60 directly, 83 through them).");
    expect(cfg.clipboard).toContain("- src/match.ts");
  });
});
