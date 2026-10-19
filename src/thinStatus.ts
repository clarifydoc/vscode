import * as vscode from "vscode";
import * as path from "path";
import { loadAnalysis } from "./analysisData";
import { ExtensionState } from "./state";
import { thinFileNote } from "./thinMap";

/**
 * "The map is thin here" in the status bar while a file the analysis read
 * thinly is open — read in part, or importing what resolves nowhere — so an
 * empty hover, CodeLens or call hierarchy there is not read as a fact.
 * Clicking it opens Problems, where the same note sits on the file.
 */
export class ThinMapStatus {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly state: ExtensionState) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -6);
    this.item.name = "ClarifyDoc: thin map";
    this.item.command = "workbench.actions.view.problems";
    state.context.subscriptions.push(
      this.item,
      vscode.window.onDidChangeActiveTextEditor(() => void this.refresh()),
      state.onAnalysisChanged(() => void this.refresh()),
    );
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
    if (!uri || !folder) return this.item.hide();
    const analysis = await loadAnalysis(this.state.context, folder).catch(() => null);
    const rel = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/");
    const note = thinFileNote(analysis?.thinFiles.get(rel));
    if (!note) return this.item.hide();
    this.item.text = "$(eye-closed) thin map";
    this.item.tooltip = note;
    this.item.show();
  }
}
