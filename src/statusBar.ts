import * as vscode from "vscode";
import { loadSummary } from "./analysisData";
import { ExtensionState } from "./state";
import { escapeMd } from "./markdown";

/**
 * A single left-aligned status bar item summarising the primary folder's last
 * analysis. Clicking it opens the report (or starts an analysis if none yet).
 */
export class StatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly state: ExtensionState) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      -5,
    );
    this.item.name = "ClarifyDoc";
    state.context.subscriptions.push(this.item);
  }

  async refresh(): Promise<void> {
    const folder = (vscode.workspace.workspaceFolders ?? [])[0];
    if (!folder) {
      this.item.hide();
      return;
    }

    if (this.state.isRunning(folder.uri.fsPath)) {
      this.item.text = "$(loading~spin) ClarifyDoc";
      this.item.tooltip = "ClarifyDoc: analyzing…";
      this.item.command = "clarifydoc.showOutput";
      this.item.show();
      return;
    }

    const summary = await loadSummary(this.state.context, folder);
    if (!summary) {
      this.item.text = "$(book) ClarifyDoc";
      this.item.tooltip = "ClarifyDoc: click to analyze this workspace";
      this.item.command = "clarifydoc.analyze";
      this.item.show();
      return;
    }

    const grade = summary.health?.grade;
    this.item.text = grade ? `$(book) ClarifyDoc: ${grade}` : "$(book) ClarifyDoc";
    this.item.tooltip = new vscode.MarkdownString(
      [
        `**ClarifyDoc — ${escapeMd(folder.name)}**`,
        "",
        grade ? `Health: **${escapeMd(grade)}** (${summary.health?.score}/100)` : "",
        `Files: ${summary.counts.files} · Routes: ${summary.counts.routes} · Links: ${summary.counts.links}`,
        `Traces: ${summary.counts.traces} · Security: ${summary.counts.security}`,
        "",
        "Click to open the report.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    this.item.command = "clarifydoc.openReport";
    this.item.show();
  }
}
