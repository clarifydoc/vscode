import * as vscode from "vscode";
import * as fs from "fs";
import { execFile } from "child_process";
import { ExtensionState } from "./state";
import { resolveCli, runClarifyDoc } from "./cli";
import { outputBaseDir, summaryPath } from "./paths";
import { absFor } from "./reveal";
import { ImpactIcon, ImpactNode, ImpactResult, impactNodes } from "./impactModel";
import { CompareBase, describeBase, parseRefs } from "./compareBase";
import { pickWorkspaceFolder } from "./workspace";
import { analyzeBase, diffWithBase, hasBaseAnalysis } from "./surfaceCompare";
import { surfaceNode } from "./surfaceModel";

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
  cochange: "git-compare",
  person: "person",
  break: "error",
  caller: "call-incoming",
  unverified: "warning",
  function: "symbol-method",
};

const RISK_COLOR: Record<ImpactResult["risk"]["level"], string | undefined> = {
  high: "errorForeground",
  moderate: "editorWarning.foreground",
  low: undefined,
};

/** `git -C folder …`, resolving to stdout; never runs a `core.fsmonitor` command the repository configures. */
function git(folder: vscode.WorkspaceFolder, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("git", ["-c", "core.fsmonitor=false", "-C", folder.uri.fsPath, ...args], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout),
    ),
  );
}

const baseKey = (folder: vscode.WorkspaceFolder) => `clarifydoc.impactBase:${folder.uri.fsPath}`;

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
 * the view is visible. The badge counts the affected routes. "Compare with…"
 * sets a branch, tag or commit per folder to diff against instead of HEAD.
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
        if (!e.visible) return;
        this.watchGit();
        this.schedule(0);
      }),
      state.onAnalysisChanged(() => this.schedule(0)),
      vscode.workspace.onDidSaveTextDocument(() => this.schedule()),
      vscode.commands.registerCommand("clarifydoc.refreshImpact", () => this.schedule(0)),
      vscode.commands.registerCommand("clarifydoc.impactCompareWith", (target, ref?: string) => this.pickBase(target, ref)),
      vscode.commands.registerCommand("clarifydoc.impactCopyForAgent", (target) => this.copyForAgent(target)),
      vscode.commands.registerCommand("clarifydoc.impactCompareSurface", (target) => this.compareSurface(target)),
    );
    this.describe();
    if (this.view.visible) this.watchGit();
  }

  private gitWatched = false;

  /** Follow git state from when the view is first shown: a hidden view recomputes nothing. */
  private watchGit(): void {
    if (this.gitWatched) return;
    this.gitWatched = true;
    void this.followGit();
  }

  private async followGit(): Promise<void> {
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

  private baseOf(folder: vscode.WorkspaceFolder): CompareBase | undefined {
    return this.state.context.workspaceState.get<CompareBase>(baseKey(folder));
  }

  /** The view caption says what it compares against, when that is not HEAD (one folder only). */
  private describe(): void {
    const folders = vscode.workspace.workspaceFolders ?? [];
    this.view.description = folders.length === 1 ? describeBase(this.baseOf(folders[0])) : undefined;
  }

  /** "Compare with…": HEAD, a branch, a tag, or any ref or commit typed in. A ref passed in (a keybinding's argument) skips the picker; "HEAD" resets. */
  private async pickBase(target?: vscode.WorkspaceFolder | vscode.Uri, givenRef?: string): Promise<void> {
    const folder = await pickWorkspaceFolder(target);
    if (!folder) return;
    if (typeof givenRef === "string" && givenRef.trim()) return this.setBase(folder, givenRef.trim() === "HEAD" ? undefined : givenRef.trim());
    let refs: ReturnType<typeof parseRefs> = [];
    try {
      refs = parseRefs(
        await git(folder, [
          "for-each-ref",
          "--sort=-committerdate",
          "--count=60",
          "--format=%(refname)%09%(committerdate:relative)",
          "refs/heads",
          "refs/remotes",
          "refs/tags",
        ]),
      );
    } catch (err) {
      void vscode.window.showWarningMessage(`ClarifyDoc: ${folder.name} is not a git repository (${err instanceof Error ? err.message : err}).`);
      return;
    }
    const current = this.baseOf(folder);
    type Item = vscode.QuickPickItem & { ref?: string; head?: true; other?: true };
    const icon = { branch: "$(git-branch)", remote: "$(cloud)", tag: "$(tag)" } as const;
    const items: Item[] = [
      { label: "$(edit) HEAD", description: "uncommitted changes only", detail: current ? undefined : "current", head: true },
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      ...refs.map((r) => ({
        label: `${icon[r.kind]} ${r.ref}`,
        description: r.when,
        detail: current?.label === r.ref ? "current" : undefined,
        ref: r.ref,
      })),
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      { label: "$(git-commit) Another ref or commit…", other: true },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: `Compare ${folder.name} with…`,
      placeHolder: "What your branch adds since it forked from this — merge-base, as a pull request shows it",
    });
    if (!picked) return;
    let ref = picked.ref;
    if (picked.other) {
      ref = (await vscode.window.showInputBox({ prompt: "A branch, tag or commit", placeHolder: "main, v1.4.0, a1b2c3d" }))?.trim();
      if (!ref) return;
    }
    return this.setBase(folder, picked.head ? undefined : ref);
  }

  private async setBase(folder: vscode.WorkspaceFolder, ref: string | undefined): Promise<void> {
    let base: CompareBase | undefined;
    if (ref) {
      try {
        // Fork point with HEAD; a ref with no common history is compared directly.
        const commit = (await git(folder, ["merge-base", ref, "HEAD"]).catch(() => git(folder, ["rev-parse", "--verify", `${ref}^{commit}`]))).trim();
        base = { label: ref, commit };
      } catch (err) {
        void vscode.window.showWarningMessage(`ClarifyDoc: cannot compare with ${ref}: ${err instanceof Error ? err.message : err}`);
        return;
      }
    }
    await this.state.context.workspaceState.update(baseKey(folder), base);
    this.describe();
    this.schedule(0);
  }

  /**
   * The impact as Markdown on the clipboard (`impact --md`, against the same
   * base): what an agent should read before it changes more — the callers that
   * break, the routes and screens reached, the tests to run.
   */
  private async copyForAgent(target?: vscode.WorkspaceFolder | vscode.Uri): Promise<void> {
    const folder = await pickWorkspaceFolder(target);
    if (!folder) return;
    if (!fs.existsSync(summaryPath(this.state.context, folder))) {
      void vscode.window.showInformationMessage("ClarifyDoc: analyze the workspace first.");
      return;
    }
    const cli = await resolveCli(this.state.context.extensionPath);
    const args = ["impact", folder.uri.fsPath, "-o", outputBaseDir(this.state.context, folder), "--md"];
    const base = this.baseOf(folder);
    if (base) args.push("--base", base.commit);
    const result = await runClarifyDoc(cli, args, { cwd: folder.uri.fsPath }).catch(() => undefined);
    if (!result || result.code !== 0 || !result.stdout.trim()) {
      void vscode.window.showWarningMessage("ClarifyDoc: could not compute the impact (see the output).");
      return;
    }
    await vscode.env.clipboard.writeText(result.stdout);
    void vscode.window.showInformationMessage(`ClarifyDoc: the impact of your changes${base ? ` ${describeBase(base)}` : ""} is on the clipboard, as Markdown.`);
  }

  /**
   * "Compare API Surface": analyze the compared base once (a temporary
   * worktree, seeded from this analysis), so the view can list what the
   * branch changes in routes, guards, bodies and cross-tier links.
   */
  private async compareSurface(target?: vscode.WorkspaceFolder | vscode.Uri): Promise<void> {
    const folder = await pickWorkspaceFolder(target);
    if (!folder) return;
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showInformationMessage("ClarifyDoc: comparing the API surface needs a trusted workspace.");
      return;
    }
    if (!fs.existsSync(summaryPath(this.state.context, folder))) {
      void vscode.window.showInformationMessage("ClarifyDoc: analyze the workspace first.");
      return;
    }
    if (!this.baseOf(folder)) await this.pickBase(folder);
    const base = this.baseOf(folder);
    if (!base) return;
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `ClarifyDoc: API surface vs ${base.label}`, cancellable: true },
        (progress, token) => analyzeBase(this.state.context, folder, base, (message) => progress.report({ message }), token),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state.output.warn(`[surface] ${folder.name}: ${message}`);
      if (message !== "cancelled") void vscode.window.showWarningMessage(`ClarifyDoc: could not analyze ${base.label}: ${message}`);
      return;
    }
    this.schedule(0);
  }

  /** The API-surface group: the diff when the base was analyzed, else a row that offers to. */
  private async surfaceOf(folder: vscode.WorkspaceFolder, base: CompareBase): Promise<ImpactNode> {
    if (!(await hasBaseAnalysis(this.state.context, folder, base.commit))) {
      return {
        label: `API surface vs ${base.label}`,
        description: "click to compare routes, guards and bodies",
        icon: "info",
        command: { id: "clarifydoc.impactCompareSurface", title: "Compare API Surface", arguments: [folder] },
      };
    }
    try {
      return surfaceNode(await diffWithBase(this.state.context, folder, base.commit), base.label);
    } catch (err) {
      this.state.output.warn(`[surface] ${folder.name}: ${err instanceof Error ? err.message : String(err)}`);
      return { label: `API surface vs ${base.label}`, description: "could not diff (see the output)", icon: "info" };
    }
  }

  private async impactOf(folder: vscode.WorkspaceFolder): Promise<{ nodes: ImpactNode[]; routes: number } | { message: string }> {
    if (!fs.existsSync(summaryPath(this.state.context, folder))) return { message: "Analyze the workspace to see what your changes reach" };
    if (!vscode.workspace.isTrusted) return { message: "Needs a trusted workspace" };
    const cli = await resolveCli(this.state.context.extensionPath);
    const args = ["impact", folder.uri.fsPath, "-o", outputBaseDir(this.state.context, folder), "--json"];
    const base = this.baseOf(folder);
    if (base) args.push("--base", base.commit);
    try {
      const result = await runClarifyDoc(cli, args, { cwd: folder.uri.fsPath });
      if (result.code !== 0) {
        this.state.output.warn(`[impact] ${folder.name}: exit ${result.code} ${result.stderr.trim().split("\n").pop() ?? ""}`);
        // Most often: not a git repository.
        return { message: result.stderr.includes("git") ? "Needs a git repository" : "Could not compute the impact (see the output)" };
      }
      const parsed = JSON.parse(result.stdout) as ImpactResult;
      const nodes = impactNodes(parsed);
      if (base) nodes.unshift(await this.surfaceOf(folder, base));
      return { nodes, routes: parsed.routeCount };
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
      item.description = describeBase(this.baseOf(row.folder));
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
    } else if (node.command) {
      item.command = { command: node.command.id, title: node.command.title, arguments: node.command.arguments };
    }
    return item;
  }
}
