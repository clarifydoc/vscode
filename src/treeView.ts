import * as vscode from "vscode";
import { readSummary, AnalysisSummary } from "./summary";
import { ExtensionState } from "./state";

type NodeKind = "folder" | "action" | "metric" | "group" | "leaf";

class Node extends vscode.TreeItem {
  constructor(
    public readonly kind: NodeKind,
    label: string,
    collapsible: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    public readonly folder?: vscode.WorkspaceFolder,
    public readonly children: Node[] = [],
  ) {
    super(label, collapsible);
  }
}

/**
 * The ClarifyDoc sidebar: one collapsible section per workspace folder showing
 * its last analysis (health, headline metrics, detected frameworks). Reads the
 * on-disk summary lazily so it survives VS Code restarts with no re-scan.
 */
export class SummaryTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChange = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly state: ExtensionState) {}

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return node;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (node) return node.children;

    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) return [];

    // Single folder → flatten to the summary directly (no redundant top node).
    if (folders.length === 1) {
      return this.folderChildren(folders[0]);
    }

    const nodes: Node[] = [];
    for (const f of folders) {
      const top = new Node(
        "folder",
        f.name,
        vscode.TreeItemCollapsibleState.Expanded,
        f,
        await this.folderChildren(f),
      );
      top.iconPath = new vscode.ThemeIcon("folder");
      nodes.push(top);
    }
    return nodes;
  }

  private async folderChildren(folder: vscode.WorkspaceFolder): Promise<Node[]> {
    if (this.state.isRunning(folder.uri.fsPath)) {
      const running = new Node("leaf", "Analyzing…");
      running.iconPath = new vscode.ThemeIcon("loading~spin");
      return [running];
    }

    const summary = await readSummary(this.state.context, folder);
    if (!summary) {
      const empty = new Node("action", "Analyze Workspace", vscode.TreeItemCollapsibleState.None, folder);
      empty.iconPath = new vscode.ThemeIcon("search-fuzzy");
      empty.command = {
        command: "clarifydoc.analyze",
        title: "Analyze Workspace",
        arguments: [folder],
      };
      empty.description = "no analysis yet";
      return [empty];
    }

    return [
      this.healthNode(summary, folder),
      this.metricsGroup(summary, folder),
      this.frameworksGroup(summary),
    ].filter((n): n is Node => n !== undefined);
  }

  private healthNode(summary: AnalysisSummary, folder: vscode.WorkspaceFolder): Node {
    const grade = summary.health?.grade ?? "—";
    const score = summary.health?.score;
    const node = new Node("metric", `Health: ${grade}`, vscode.TreeItemCollapsibleState.None, folder);
    node.description = score != null ? `${score}/100` : undefined;
    node.iconPath = new vscode.ThemeIcon(gradeIcon(grade), gradeColor(grade));
    node.tooltip = summary.analyzedAt
      ? `Last analyzed ${new Date(summary.analyzedAt).toLocaleString()}`
      : undefined;
    node.command = {
      command: "clarifydoc.openReport",
      title: "Open Report",
      arguments: [folder],
    };
    return node;
  }

  private metricsGroup(summary: AnalysisSummary, folder: vscode.WorkspaceFolder): Node {
    const c = summary.counts;
    const rows: [string, number, string][] = [
      ["Files", c.files, "file-code"],
      ["Routes", c.routes, "milestone"],
      ["Links", c.links, "references"],
      ["Call traces", c.traces, "arrow-swap"],
      ["Screens", c.screens, "browser"],
      ["API calls", c.apiCalls, "radio-tower"],
      ["Entities", c.entities, "database"],
      ["Sub-projects", c.subProjects, "project"],
      ["Layer violations", c.layerViolations, "warning"],
      ["Duplicates", c.duplicates, "copy"],
      ["Security issues", c.security, "shield"],
      ["Suggestions", c.suggestions, "lightbulb"],
    ];
    const children = rows
      .filter(([, n]) => n > 0)
      .map(([label, n, icon]) => {
        const leaf = new Node("metric", label, vscode.TreeItemCollapsibleState.None, folder);
        leaf.description = String(n);
        leaf.iconPath = new vscode.ThemeIcon(icon);
        leaf.command = {
          command: "clarifydoc.openReport",
          title: "Open Report",
          arguments: [folder],
        };
        return leaf;
      });

    const group = new Node(
      "group",
      "Summary",
      vscode.TreeItemCollapsibleState.Expanded,
      folder,
      children,
    );
    group.iconPath = new vscode.ThemeIcon("graph");
    return group;
  }

  private frameworksGroup(summary: AnalysisSummary): Node | undefined {
    if (!summary.frameworks.length) return undefined;
    const children = summary.frameworks.map((fw) => {
      const leaf = new Node("leaf", fw.name);
      leaf.description = fw.confidence;
      leaf.tooltip = fw.detectedVia;
      leaf.iconPath = new vscode.ThemeIcon("layers");
      return leaf;
    });
    const group = new Node(
      "group",
      "Frameworks",
      vscode.TreeItemCollapsibleState.Collapsed,
      undefined,
      children,
    );
    group.description = String(summary.frameworks.length);
    group.iconPath = new vscode.ThemeIcon("layers");
    return group;
  }
}

function gradeIcon(grade: string): string {
  const g = grade.toUpperCase()[0];
  if (g === "A" || g === "B") return "pass-filled";
  if (g === "C") return "info";
  return "error";
}

function gradeColor(grade: string): vscode.ThemeColor {
  const g = grade.toUpperCase()[0];
  if (g === "A" || g === "B") return new vscode.ThemeColor("charts.green");
  if (g === "C") return new vscode.ThemeColor("charts.yellow");
  return new vscode.ThemeColor("charts.red");
}
