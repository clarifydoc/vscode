import * as assert from "assert";
import * as vscode from "vscode";

// Opens a real, already analyzed project in place (CLARIFYDOC_STARTUP_PROJECT,
// see runTest.ts) and checks what a window costs at start: the analysis read
// once, on a worker thread, and no analysis change announced. The times are
// printed, never asserted: wall clock is too noisy to gate on.
const EXT_ID = "clarifydoc.clarifydoc-vscode";

type Stats = {
  activateMs: number;
  analysisEvents: number;
  summaryReads: number;
  offThreadReads: number;
  milestones: Record<string, number>;
  longestPauseMs?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

suite("Startup on a real project", () => {
  test("reads the analysis once, off the extension-host thread, and announces no change", async () => {
    await vscode.extensions.getExtension(EXT_ID)!.activate();
    const stats = () => vscode.commands.executeCommand<Stats>("clarifydoc.internal.startupStats");
    // Shows the sidebar, so its first rows are asked for as in a real window.
    await vscode.commands.executeCommand("workbench.view.extension.clarifydoc").then(undefined, () => undefined);
    for (let i = 0; i < 600 && (await stats()).summaryReads === 0; i++) await sleep(100);
    // The pause probe reports after 10 s; the background answers land before that.
    for (let i = 0; i < 300 && (await stats()).longestPauseMs === undefined; i++) await sleep(100);
    const s = await stats();
    const at = Object.entries(s.milestones).map(([name, ms]) => `${name} ${ms} ms`);
    console.log(`[startup] activated in ${s.activateMs} ms; ${at.join("; ")}; longest pause ${s.longestPauseMs} ms`);
    assert.strictEqual(s.summaryReads, 1, "the summary was read more than once");
    assert.strictEqual(s.offThreadReads, 1, "the summary was not read on a worker thread (see the output channel)");
    assert.strictEqual(s.analysisEvents, 0, "an analysis change was announced with nothing changed");
  });
});
