import * as vscode from "vscode";
import { loadAnalysis, relPathOf } from "./analysisData";
import { ExtensionState } from "./state";

/**
 * VSCODE-PLAN 5.4, coverage: the lines no test runs, marked in the editor —
 * a faint background and a mark in the overview ruler — from the coverage
 * reports the analysis read (`testCoverage`). The hover says which report
 * and whether it is older than the code. `clarifydoc.coverage.overlay` (on
 * by default; it shows only where a report covers the file) and the
 * *Toggle Coverage Overlay* command turn it off.
 */
export class CoverageOverlay {
  private readonly uncovered = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("diffEditor.removedLineBackground"),
    overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.deletedForeground"),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  private hidden = false;

  constructor(private readonly state: ExtensionState) {
    state.context.subscriptions.push(
      this.uncovered,
      vscode.window.onDidChangeVisibleTextEditors(() => void this.refresh()),
      state.onAnalysisChanged(() => void this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("clarifydoc.coverage.overlay")) void this.refresh();
      }),
      vscode.commands.registerCommand("clarifydoc.toggleCoverage", () => {
        this.hidden = !this.hidden;
        vscode.window.setStatusBarMessage(`ClarifyDoc: coverage overlay ${this.hidden ? "off" : "on"}`, 2500);
        void this.refresh();
      }),
      // For tests: the uncovered ranges drawn in one editor.
      vscode.commands.registerCommand("clarifydoc.internal.coverageRanges", (uri: vscode.Uri) => this.drawn.get(uri.toString()) ?? []),
    );
    void this.refresh();
  }

  private readonly drawn = new Map<string, Array<[number, number]>>();

  async refresh(): Promise<void> {
    this.drawn.clear();
    for (const editor of vscode.window.visibleTextEditors) {
      const doc = editor.document;
      const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
      const on = !this.hidden && vscode.workspace.getConfiguration("clarifydoc", doc.uri).get<boolean>("coverage.overlay", true);
      const rel = folder ? relPathOf(folder, doc.uri) : undefined;
      const cov = on && folder && rel ? (await loadAnalysis(this.state.context, folder).catch(() => undefined))?.testCoverage.get(rel) : undefined;
      if (!cov) {
        editor.setDecorations(this.uncovered, []);
        continue;
      }
      const hover = new vscode.MarkdownString(
        `**No test runs this line** — ${cov.covered} of ${cov.total} counted lines in this file are run (${Math.round((cov.covered / cov.total) * 100)}%), ` +
          `from ${cov.sources.map((s) => `\`${s}\``).join(", ")}.` +
          (cov.stale || doc.isDirty ? "\n\n⚠ The report is older than the code: lines may have moved." : ""),
      );
      const last = doc.lineCount;
      const ranges = cov.uncovered
        .filter(([a]) => a <= last)
        .map(([a, b]) => ({ range: new vscode.Range(a - 1, 0, Math.min(b, last) - 1, 0), hoverMessage: hover }));
      editor.setDecorations(this.uncovered, ranges);
      this.drawn.set(doc.uri.toString(), cov.uncovered);
    }
  }
}
