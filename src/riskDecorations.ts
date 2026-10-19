import * as path from "path";
import * as vscode from "vscode";
import { loadAnalysis } from "./analysisData";
import { getConfig } from "./config";
import { riskMark } from "./riskMarks";
import { ExtensionState } from "./state";

/**
 * Files the analysis rates high or critical to change, marked in the Explorer
 * and on editor tabs (V-09) — the same verdict the risk CodeLens shows, seen
 * before the file is opened. Built once per analysis, so a decoration request
 * is a map lookup. `clarifydoc.decorations.risk` turns it off.
 */
export class RiskDecorations implements vscode.FileDecorationProvider {
  private readonly changed = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this.changed.event;
  private marks = new Map<string, vscode.FileDecoration>();

  constructor(private readonly state: ExtensionState) {
    state.context.subscriptions.push(
      this.changed,
      vscode.window.registerFileDecorationProvider(this),
      state.onAnalysisChanged(() => void this.rebuild()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.rebuild()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("clarifydoc.decorations.risk")) void this.rebuild();
      }),
      // For tests: what is marked, since the editor offers no way to read a decoration back.
      vscode.commands.registerCommand("clarifydoc.internal.riskMarks", () =>
        [...this.marks].map(([uri, d]) => ({ uri, badge: d.badge, tooltip: d.tooltip })),
      ),
    );
    void this.rebuild();
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    return this.marks.get(uri.toString());
  }

  private async rebuild(): Promise<void> {
    const next = new Map<string, vscode.FileDecoration>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (!getConfig(folder.uri).riskDecorations) continue;
      const analysis = await loadAnalysis(this.state.context, folder).catch(() => undefined);
      for (const [rel, verdict] of analysis?.risky ?? []) {
        const m = riskMark(verdict);
        const d = new vscode.FileDecoration(m.badge, m.tooltip, new vscode.ThemeColor(m.color));
        next.set(vscode.Uri.file(path.join(folder.uri.fsPath, rel)).toString(), d);
      }
    }
    // Tell the Explorer about every file whose mark came, went or changed.
    const touched = new Set([...this.marks.keys(), ...next.keys()].filter((k) => this.marks.get(k)?.tooltip !== next.get(k)?.tooltip));
    this.marks = next;
    if (touched.size) this.changed.fire([...touched].map((k) => vscode.Uri.parse(k)));
  }
}
