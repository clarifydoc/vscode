import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { resetCliResolution, bundleAvailable } from "./cli";
import { getConfig } from "./config";
import { analyzeWorkspace } from "./analyze";
import { showReport } from "./report";
import { refreshOpenReport } from "./reportPanel";
import { detectFrameworks, impactOfChanges } from "./extraCommands";
import { jumpToFileView } from "./jump";
import { SummaryTreeProvider } from "./treeView";
import { StatusBar } from "./statusBar";
import { pickWorkspaceFolder } from "./workspace";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("ClarifyDoc");
  context.subscriptions.push(output);

  const running = new Set<string>();

  // Forward-declared so the state's refresh() can reach the views created below.
  let tree: SummaryTreeProvider | undefined;
  let statusBar: StatusBar | undefined;

  const state: ExtensionState = {
    context,
    output,
    refresh() {
      tree?.refresh();
      void statusBar?.refresh();
    },
    isRunning: (p) => running.has(p),
    setRunning: (p, on) => {
      if (on) running.add(p);
      else running.delete(p);
    },
  };

  tree = new SummaryTreeProvider(state);
  statusBar = new StatusBar(state);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("clarifydoc.summary", tree),
  );

  // ── Commands ──────────────────────────────────────────────────────────
  const register = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  register("clarifydoc.analyze", (target) => analyzeWorkspace(state, target));
  register("clarifydoc.analyzeFull", (target) =>
    analyzeWorkspace(state, target, { fullRescan: true }),
  );
  register("clarifydoc.openReport", async (target) => {
    const folder = await pickWorkspaceFolder(target);
    if (folder) await showReport(state, folder);
  });
  register("clarifydoc.openReportExternal", async (target) => {
    const folder = await pickWorkspaceFolder(target);
    if (folder) await showReport(state, folder, { location: "browser" });
  });
  register("clarifydoc.detectFrameworks", (target) => detectFrameworks(state, target));
  register("clarifydoc.impact", (target) => impactOfChanges(state, target));

  // Right-click-in-code jumps into the report focused on the current file.
  register("clarifydoc.jumpScreens", () => jumpToFileView(state, "ui"));
  register("clarifydoc.jumpTraces", () => jumpToFileView(state, "traces"));
  register("clarifydoc.jumpBlast", () => jumpToFileView(state, "blast"));
  register("clarifydoc.jumpArchitecture", () => jumpToFileView(state, "links"));
  register("clarifydoc.jumpRoutes", () => jumpToFileView(state, "routes"));
  register("clarifydoc.refresh", () => {
    resetCliResolution();
    state.refresh();
  });
  register("clarifydoc.showOutput", () => output.show(true));
  register("clarifydoc.openSettings", () =>
    vscode.commands.executeCommand("workbench.action.openSettings", "clarifydoc"),
  );

  // ── Reactivity ────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("clarifydoc.cliPath") || e.affectsConfiguration("clarifydoc.nodePath")) {
        resetCliResolution();
      }
      state.refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => state.refresh()),
  );

  registerAnalyzeOnSave(context, state);

  // The analyzer is bundled inside the extension; warn once if the bundle is
  // absent (e.g. running from source without `npm run bundle`) unless a custom
  // cliPath is configured.
  if (!bundleAvailable(context.extensionPath) && !getConfig().cliPath) {
    output.appendLine(
      "[warning] bundled analyzer not found at clarifydoc/dist/cli.js — run `npm run bundle`, or set clarifydoc.cliPath.",
    );
  }

  // Populate the views from any existing on-disk analysis.
  state.refresh();
}

export function deactivate(): void {
  /* nothing to tear down beyond the disposables registered above */
}

/**
 * Debounced re-analysis on save. Only fires for files inside a workspace folder
 * and skips output written under the analysis directory to avoid feedback loops.
 */
function registerAnalyzeOnSave(
  context: vscode.ExtensionContext,
  state: ExtensionState,
): void {
  const timers = new Map<string, NodeJS.Timeout>();
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
      if (!folder) return;
      if (!getConfig(folder.uri).analyzeOnSave) return;
      // Output lives in isolated global storage, never in the workspace, so a
      // saved workspace file can't feed back into the analysis.
      if (state.isRunning(folder.uri.fsPath)) return;

      const key = folder.uri.fsPath;
      clearTimeout(timers.get(key));
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          void analyzeWorkspace(state, folder).then(() => refreshOpenReport(state.context, folder));
        }, 2500),
      );
    }),
  );
}
