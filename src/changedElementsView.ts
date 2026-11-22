import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { absFor } from "./reveal";
import { changeHub } from "./changeOverlayHub";
import { ChangeKind, ChangedNode, changedElementNodes } from "./changeOverlay";

/**
 * Each kind has its own icon shape as well as its colour (a pencil, a plus, a
 * trash can, an arrow) and its glyph leads the label, so no kind is told only
 * by colour.
 */
const KIND_ICON: Record<ChangeKind, { id: string; color: string }> = {
  changed: { id: "diff-modified", color: "gitDecoration.modifiedResourceForeground" },
  added: { id: "diff-added", color: "gitDecoration.addedResourceForeground" },
  removed: { id: "diff-removed", color: "gitDecoration.deletedResourceForeground" },
  reached: { id: "arrow-right", color: "charts.blue" },
};

type Row = { node: ChangedNode; folder: vscode.WorkspaceFolder } | { folder: vscode.WorkspaceFolder; header: true };

/**
 * "ClarifyDoc Changed Elements" in Source Control: what the working tree and
 * the compared base changed, added, removed and reached — files, routes,
 * screens, tables — in one tree. It lists what the Impact view computes, so it
 * asks that view to compute when it is first shown.
 */
export class ChangedElementsView implements vscode.TreeDataProvider<Row> {
  private readonly changed = new vscode.EventEmitter<Row | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly view: vscode.TreeView<Row>;

  constructor(state: ExtensionState) {
    this.view = vscode.window.createTreeView("clarifydoc.changedElements", { treeDataProvider: this });
    state.context.subscriptions.push(
      this.view,
      this.changed,
      changeHub.onDidChange(() => this.refresh()),
      this.view.onDidChangeVisibility((e) => {
        if (e.visible) void vscode.commands.executeCommand("clarifydoc.refreshImpact");
      }),
    );
    if (this.view.visible) void vscode.commands.executeCommand("clarifydoc.refreshImpact");
  }

  private refresh(): void {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const total = folders.reduce((n, f) => n + (changeHub.get(f.uri.fsPath)?.entries.length ?? 0), 0);
    this.view.badge = total > 0 ? { value: total, tooltip: `${total} element(s) changed, added, removed or reached` } : undefined;
    this.changed.fire(undefined);
  }

  getChildren(row?: Row): Row[] {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!row) {
      if (folders.length > 1) return folders.map((folder) => ({ folder, header: true as const }));
      return folders.length ? this.rootsOf(folders[0]!) : [];
    }
    if ("header" in row) return this.rootsOf(row.folder);
    return (row.node.children ?? []).map((node) => ({ node, folder: row.folder }));
  }

  private rootsOf(folder: vscode.WorkspaceFolder): Row[] {
    return changedElementNodes(changeHub.get(folder.uri.fsPath)).map((node) => ({ node, folder }));
  }

  getTreeItem(row: Row): vscode.TreeItem {
    if ("header" in row) {
      const item = new vscode.TreeItem(row.folder.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon("root-folder");
      return item;
    }
    const { node, folder } = row;
    const item = new vscode.TreeItem(node.label, node.children?.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    item.description = node.description;
    if (node.kind) {
      const icon = KIND_ICON[node.kind];
      item.iconPath = new vscode.ThemeIcon(icon.id, new vscode.ThemeColor(icon.color));
    }
    if (node.file) {
      const abs = absFor(folder, node.file);
      item.tooltip = node.line ? `${node.file}:${node.line}` : node.file;
      // A removed element has no file to open.
      if (node.kind !== "removed") item.command = { command: "clarifydoc.revealSource", title: "Open", arguments: [abs, node.line] };
    }
    return item;
  }
}
