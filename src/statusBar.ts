import * as vscode from "vscode";
import { freshnessOf, invalidateFreshness, loadSummary } from "./analysisData";
import { describeFreshness } from "./freshness";
import { ExtensionState } from "./state";
import { escapeMd } from "./markdown";
import { bundledAnalyzerVersion } from "./cli";
import { milestone } from "./startupClock";

/**
 * A single left-aligned status bar item summarising the last analysis of the
 * folder you are working in — the active editor's, else the first. Clicking
 * it opens that folder's report (or starts an analysis if there is none yet).
 */
export class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly versions: string;

  constructor(private readonly state: ExtensionState) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -5);
    this.item.name = "ClarifyDoc";
    const ext = String(state.context.extension?.packageJSON?.version ?? "?");
    const analyzer = bundledAnalyzerVersion(state.context.extensionPath);
    this.versions = `extension ${ext}${analyzer ? ` · analyzer ${analyzer}` : ""}`;
    state.context.subscriptions.push(
      this.item,
      vscode.window.onDidChangeActiveTextEditor(() => void this.refresh()),
      // Files may have changed outside the editor (a pull, a branch switch).
      vscode.window.onDidChangeWindowState((w) => {
        if (!w.focused) return;
        invalidateFreshness();
        void this.refresh();
      }),
      state.onAnalysisChanged(() => {
        invalidateFreshness();
        void this.refresh();
      }),
    );
  }

  /** The folder the status bar speaks for. */
  private folder(): vscode.WorkspaceFolder | undefined {
    const active = vscode.window.activeTextEditor?.document.uri;
    return (active && vscode.workspace.getWorkspaceFolder(active)) ?? (vscode.workspace.workspaceFolders ?? [])[0];
  }

  async refresh(): Promise<void> {
    const folder = this.folder();
    if (!folder) {
      this.item.hide();
      return;
    }
    const multi = (vscode.workspace.workspaceFolders ?? []).length > 1;
    const name = multi ? ` (${folder.name})` : "";

    if (this.state.isRunning(folder.uri.fsPath)) {
      this.item.text = `$(loading~spin) ClarifyDoc${name}`;
      this.item.tooltip = `ClarifyDoc: analyzing ${folder.name}…`;
      this.item.command = "clarifydoc.showOutput";
      this.item.show();
      return;
    }

    const summary = await loadSummary(this.state.context, folder);
    if (folder !== this.folder()) return; // the active editor moved on while loading
    if (!summary) {
      this.item.text = `$(book) ClarifyDoc${name}`;
      this.item.tooltip = `ClarifyDoc: click to analyze ${folder.name}\n\n${this.versions}`;
      this.item.command = { title: "Analyze", command: "clarifydoc.analyze", arguments: [folder] };
      this.item.show();
      return;
    }

    const note = describeFreshness(await freshnessOf(this.state.context, folder));
    if (folder !== this.folder() || this.state.isRunning(folder.uri.fsPath)) return;

    const grade = summary.health?.grade;
    const icon = note.stale ? "$(sync)" : "$(book)";
    this.item.text = `${icon} ClarifyDoc${name}${grade ? `: ${grade}` : ""}${note.suffix}`;
    this.item.tooltip = new vscode.MarkdownString(
      [
        `**ClarifyDoc — ${escapeMd(folder.name)}**`,
        "",
        ...(grade ? [`Health: **${escapeMd(grade)}** (${summary.health?.score}/100)`] : []),
        `Files: ${summary.counts.files} · Routes: ${summary.counts.routes} · Links: ${summary.counts.links}`,
        `Traces: ${summary.counts.traces} · Security: ${summary.counts.security}`,
        "",
        ...(note.stale ? [note.detail, "", `[Open the report](command:clarifydoc.openReport)`] : ["Click to open the report."]),
        "",
        `_${escapeMd(this.versions)}_`,
      ].join("\n"),
    );
    if (note.stale) (this.item.tooltip as vscode.MarkdownString).isTrusted = { enabledCommands: ["clarifydoc.openReport"] };
    this.item.command = note.stale
      ? { title: "Re-analyze", command: "clarifydoc.analyze", arguments: [folder] }
      : { title: "Open Report", command: "clarifydoc.openReport", arguments: [folder] };
    this.item.show();
    milestone("first status bar headline");
  }
}
