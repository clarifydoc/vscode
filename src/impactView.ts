import * as vscode from "vscode";
import * as fs from "fs";
import { ExtensionState } from "./state";
import { resolveCli, runClarifyDoc } from "./cli";
import { outputBaseDir, summaryPath } from "./paths";
import { absFor } from "./reveal";
import { ImpactIcon, ImpactNode, ImpactResult, impactNodes } from "./impactModel";

const ICONS: Record<ImpactIcon, string> = {
  risk: "warning",
  route: "globe",
  screen: "browser",
  data: "database",
  queue: "mail",
  test: "beaker",
  file: "file",
  unknown: "question",
  chain: "arrow-right",
  info: "info",
};

const RISK_COLOR: Record<ImpactResult["risk"]["level"], string | undefined> = {
  high: "errorForeground",
  moderate: "editorWarning.foreground",
  low: undefined,
};

/** Waits this long after the last git state change before recomputing. */
const DEBOUNCE_MS = 1500;

type Row = { node: ImpactNode; folder: vscode.WorkspaceFolder } | { folder: vscode.WorkspaceFolder; header: true };

/** The slice of the built-in Git extension's API used here. */
interface GitApi {
  repositories: { state: { onDidChange: vscode.Event<void> } }[];
  onDidOpenRepository: vscode.Event<{ state: { onDidChange: vscode.Event<void> } }>;
}

/**
 * "ClarifyDoc Impact" in the Source Control sidebar: what the working-tree
 * changes reach, per the last analysis — the API routes and screens above
 * them, the data below, the tests to run — with a risk level and its reasons.
 * Recomputed with `clarifydoc impact --json` when git state changes, only while
 * the view is visible. The badge counts the affected routes.
 */
export class ImpactView implements vscode.TreeDataProvider<Row> {
  private readonly changed = new vscode.EventEmitter<Row | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly view: vscode.TreeView<Row>;
  private results = new Map<string, { nodes: ImpactNode[]; routes: number } | { message: string }>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private again = false;

  constructor(private readonly state: ExtensionState) {
    this.view = vscode.window.createTreeView("clarifydoc.impact", { treeDataProvider: this });
    state.context.subscriptions.push(
      this.view,
      this.changed,
      this.view.onDidChangeVisibility((e) => {
        if (e.visible) this.schedule(0);
      }),
      state.onAnalysisChanged(() => this.schedule(0)),
      vscode.workspace.onDidSaveTextDocument(() => this.schedule()),
      vscode.commands.registerCommand("clarifydoc.refreshImpact", () => this.schedule(0)),
    );
    void this.watchGit();
  }

  private async watchGit(): Promise<void> {
    const ext = vscode.extensions.getExtension<{ getAPI(v: 1): GitApi }>("vscode.git");
    if (!ext) return;
    const git = (ext.isActive ? ext.exports : await ext.activate()).getAPI(1);
    const watch = (repo: { state: { onDidChange: vscode.Event<void> } }) =>
      this.state.context.subscriptions.push(repo.state.onDidChange(() => this.schedule()));
    git.repositories.forEach(watch);
    this.state.context.subscriptions.push(git.onDidOpenRepository(watch));
  }

  /** Recompute soon; changes in a burst (a checkout, a save-all) coalesce. */
  private schedule(delay = DEBOUNCE_MS): void {
    if (!this.view.visible) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.recompute(), delay);
  }

  private async recompute(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      const results = new Map<string, { nodes: ImpactNode[]; routes: number } | { message: string }>();
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        results.set(folder.uri.fsPath, await this.impactOf(folder));
      }
      this.results = results;
      const routes = [...results.values()].reduce((n, r) => n + ("routes" in r ? r.routes : 0), 0);
      this.view.badge = routes > 0 ? { value: routes, tooltip: `${routes} API route(s) affected by your changes` } : undefined;
      this.changed.fire(undefined);
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.schedule(0);
      }
    }
  }

  private async impactOf(folder: vscode.WorkspaceFolder): Promise<{ nodes: ImpactNode[]; routes: number } | { message: string }> {
    if (!fs.existsSync(summaryPath(this.state.context, folder))) return { message: "Analyze the workspace to see what your changes reach" };
    if (!vscode.workspace.isTrusted) return { message: "Needs a trusted workspace" };
    const cli = await resolveCli(this.state.context.extensionPath);
    const args = ["impact", folder.uri.fsPath, "-o", outputBaseDir(this.state.context, folder), "--json"];
    try {
      const result = await runClarifyDoc(cli, args, { cwd: folder.uri.fsPath });
      if (result.code !== 0) {
        this.state.output.warn(`[impact] ${folder.name}: exit ${result.code} ${result.stderr.trim().split("\n").pop() ?? ""}`);
        // Most often: not a git repository.
        return { message: result.stderr.includes("git") ? "Needs a git repository" : "Could not compute the impact (see the output)" };
      }
      const parsed = JSON.parse(result.stdout) as ImpactResult;
      return { nodes: impactNodes(parsed), routes: parsed.routeCount };
    } catch (err) {
      this.state.output.warn(`[impact] ${folder.name}: ${err instanceof Error ? err.message : String(err)}`);
      return { message: "Could not compute the impact (see the output)" };
    }
  }

  getChildren(row?: Row): Row[] {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!row) {
      if (folders.length > 1) return folders.map((folder) => ({ folder, header: true as const }));
      return folders.length ? this.rootsOf(folders[0]) : [];
    }
    if ("header" in row) return this.rootsOf(row.folder);
    return (row.node.children ?? []).map((node) => ({ node, folder: row.folder }));
  }

  private rootsOf(folder: vscode.WorkspaceFolder): Row[] {
    const r = this.results.get(folder.uri.fsPath);
    if (!r) return [{ node: { label: "Open this view to compute", icon: "info" }, folder }];
    if ("message" in r) return [{ node: { label: r.message, icon: "info" }, folder }];
    return r.nodes.map((node) => ({ node, folder }));
  }

  getTreeItem(row: Row): vscode.TreeItem {
    if ("header" in row) {
      const item = new vscode.TreeItem(row.folder.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon("root-folder");
      return item;
    }
    const { node, folder } = row;
    const collapsible = node.children?.length
      ? node.icon === "risk" || node.icon === "file"
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, collapsible);
    item.description = node.description;
    const color = node.level ? RISK_COLOR[node.level] : undefined;
    item.iconPath = new vscode.ThemeIcon(ICONS[node.icon], color ? new vscode.ThemeColor(color) : undefined);
    if (node.file) {
      const abs = absFor(folder, node.file);
      item.resourceUri = vscode.Uri.file(abs);
      item.tooltip = node.line ? `${node.file}:${node.line}` : node.file;
      item.command = { command: "clarifydoc.revealSource", title: "Open", arguments: [abs, node.line] };
    }
    return item;
  }
}
