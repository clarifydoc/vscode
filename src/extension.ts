import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { resetCliResolution, bundleAvailable, bundledAnalyzerVersion, killAllChildren } from "./cli";
import { getConfig } from "./config";
import { analyzeWorkspace } from "./analyze";
import { showReport } from "./report";
import { showControlFlow } from "./controlFlowPanel";
import { createArchitectureDiagram } from "./architectureDiagram";
import { primeControlFlowSupport, resetControlFlowSupport } from "./controlFlowSupport";
import { detectFrameworks, impactOfChanges } from "./extraCommands";
import { jumpToFileView } from "./jump";
import { itemReportHash, Node as TreeNode, SummaryTreeProvider } from "./treeView";
import { StatusBar } from "./statusBar";
import { pickWorkspaceFolder } from "./workspace";
import { DiagnosticsManager } from "./diagnostics";
import { ClarifyDocCodeLensProvider } from "./codeLens";
import { ClarifyDocHoverProvider } from "./hover";
import { ApiCallDefinitionProvider, RouteReferenceProvider } from "./apiCallProvider";
import { ClarifyDocCallHierarchyProvider } from "./callHierarchy";
import { ClarifyDocCodeActions } from "./codeActions";
import { ClarifyDocWorkspaceSymbols } from "./workspaceSymbols";
import { ImpactView } from "./impactView";
import { ClarifyDocTypeHierarchyProvider } from "./typeHierarchy";
import { exportSarif } from "./sarifExport";
import { onboard } from "./onboarding";
import { registerReportSerializer } from "./reportPanel";
import { installAgentGuidance, registerProposalProvider } from "./agentGuidance";
import { askAgent } from "./askAgent";
import { openReportForFile, showLinkedSymbols } from "./navCommands";
import { gotoQuickPick } from "./goto";
import { openSourceAt } from "./reveal";
import { registerAutoAnalyze } from "./watch";
import { ignoreFolders } from "./ignore";
import { registerMcpProvider } from "./mcp";
import { maybeOfferMcpInstall } from "./mcpInstall";
import { outputBaseDir, resetStorageResolution, storageFor } from "./paths";
import { setAnalysisLog } from "./analysisData";
import { LineTracker } from "./lineTracker";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("ClarifyDoc", { log: true });
  context.subscriptions.push(output);
  setAnalysisLog((level, message) => output[level](message));
  // Both versions, first: a bug report then names the analyzer it ran.
  output.info(
    `ClarifyDoc extension ${String(context.extension?.packageJSON?.version ?? "?")}, ` +
      `analyzer ${bundledAnalyzerVersion(context.extensionPath) ?? "not bundled"}`,
  );

  const lines = new LineTracker();
  context.subscriptions.push(lines);

  const running = new Set<string>();
  const analysisChanged = new vscode.EventEmitter<void>();
  context.subscriptions.push(analysisChanged);

  // Forward-declared so the state's refresh() can reach the views created below.
  let tree: SummaryTreeProvider | undefined;
  let statusBar: StatusBar | undefined;

  const state: ExtensionState = {
    context,
    output,
    lines,
    refresh() {
      tree?.refresh();
      void statusBar?.refresh();
    },
    isRunning: (p) => running.has(p),
    setRunning: (p, on) => {
      if (on) running.add(p);
      else running.delete(p);
    },
    onAnalysisChanged: analysisChanged.event,
    fireAnalysisChanged: () => analysisChanged.fire(),
  };

  registerReportSerializer(state);
  registerProposalProvider(state);
  tree = new SummaryTreeProvider(state);
  new ImpactView(state);
  statusBar = new StatusBar(state);

  // Editor-integration providers (data-driven, refresh on analysis change).
  const diagnostics = new DiagnosticsManager(state);
  void diagnostics.refresh();
  context.subscriptions.push(state.onAnalysisChanged(() => tree?.refresh()));

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("clarifydoc.summary", tree),
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, new ClarifyDocCodeLensProvider(state)),
    vscode.languages.registerHoverProvider({ scheme: "file" }, new ClarifyDocHoverProvider(state)),
    vscode.languages.registerDefinitionProvider({ scheme: "file" }, new ApiCallDefinitionProvider(state)),
    vscode.languages.registerReferenceProvider({ scheme: "file" }, new RouteReferenceProvider(state)),
    // VS Code asks only the best-scoring call hierarchy provider. The bare "*"
    // selector scores below a language's own (TypeScript, a C# or Java server),
    // so those keep their compiler-exact hierarchy; this one answers where no
    // language provides one.
    vscode.languages.registerCallHierarchyProvider("*", new ClarifyDocCallHierarchyProvider(state)),
    vscode.languages.registerTypeHierarchyProvider("*", new ClarifyDocTypeHierarchyProvider(state)),
    vscode.languages.registerWorkspaceSymbolProvider(new ClarifyDocWorkspaceSymbols(state)),
    vscode.languages.registerCodeActionsProvider({ scheme: "file" }, new ClarifyDocCodeActions(), {
      providedCodeActionKinds: ClarifyDocCodeActions.kinds,
    }),
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
  // Open the report deep-linked to a Health sub-section (#health/<section>).
  // Invoked from the sidebar's Health drill-down.
  register("clarifydoc.openReportSection", async (target, section?: string) => {
    const folder = await pickWorkspaceFolder(target);
    if (folder) await showReport(state, folder, { hash: section ? `health/${section}` : "health" });
  });
  register("clarifydoc.openReportExternal", async (target) => {
    const folder = await pickWorkspaceFolder(target);
    if (folder) await showReport(state, folder, { location: "browser" });
  });
  register("clarifydoc.askAgent", () => askAgent(state));
  register("clarifydoc.installAgentGuidance", (target?: vscode.WorkspaceFolder | vscode.Uri) => installAgentGuidance(state, target));
  register("clarifydoc.exportSarif", (target?: vscode.WorkspaceFolder | vscode.Uri) => exportSarif(state, target));
  register("clarifydoc.ignoreFolder", (uri?: vscode.Uri, uris?: vscode.Uri[]) => ignoreFolders(state, uri, uris));
  register("clarifydoc.detectFrameworks", (target) => detectFrameworks(state, target));
  register("clarifydoc.impact", (target) => impactOfChanges(state, target));

  // Right-click-in-code jumps into the report focused on the current file.
  register("clarifydoc.jumpScreens", () => jumpToFileView(state, "ui"));
  register("clarifydoc.jumpTraces", () => jumpToFileView(state, "traces"));
  register("clarifydoc.jumpBlast", () => jumpToFileView(state, "blast"));
  register("clarifydoc.jumpArchitecture", () => jumpToFileView(state, "links"));
  register("clarifydoc.jumpRoutes", () => jumpToFileView(state, "routes"));

  // Navigation commands (invoked from CodeLens, hover, and the sidebar).
  register("clarifydoc.goto", () => gotoQuickPick(state));
  register("clarifydoc.openReportForFile", (uri, tab) => openReportForFile(state, uri, tab));
  register("clarifydoc.showControlFlow", (uri?: string | vscode.Uri, fn?: string, line?: number) =>
    showControlFlow(state, uri, fn, line),
  );
  register("clarifydoc.createArchitectureDiagram", (target?: unknown) => createArchitectureDiagram(state, target));
  register("clarifydoc.showCallers", (uri: string, symbol: string) => showLinkedSymbols(state, uri, symbol, "callers"));
  register("clarifydoc.showCallees", (uri: string, symbol: string) => showLinkedSymbols(state, uri, symbol, "callees"));
  register("clarifydoc.revealSource", (absPath: string, line?: number) => openSourceAt(absPath, line));
  // Sidebar item actions (right-click).
  register("clarifydoc.copyTreeItem", async (node?: TreeNode) => {
    const text = node?.copyText ?? (typeof node?.label === "string" ? node.label : undefined);
    if (!text) return;
    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage(`ClarifyDoc: copied ${text}`, 2500);
  });
  for (const tab of ["blast", "traces"] as const) {
    register(tab === "blast" ? "clarifydoc.treeItemBlast" : "clarifydoc.treeItemTraces", async (node?: TreeNode) => {
      const hash = node ? itemReportHash(node, tab) : undefined;
      if (node?.folder && hash) await showReport(state, node.folder, { hash });
    });
  }
  register("clarifydoc.refresh", () => {
    resetCliResolution();
    resetControlFlowSupport();
    primeControlFlowSupport(context, output, () => state.fireAnalysisChanged());
    state.refresh();
  });
  register("clarifydoc.showOutput", () => output.show(true));
  register("clarifydoc.openSettings", () =>
    vscode.commands.executeCommand("workbench.action.openSettings", "clarifydoc"),
  );

  // Which files can have their control flow drawn, asked once, in the
  // background: the CodeLens needs the answer before anyone clicks it.
  primeControlFlowSupport(context, output, () => state.fireAnalysisChanged());

  // ── Reactivity ────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("clarifydoc.cliPath") || e.affectsConfiguration("clarifydoc.nodePath")) {
        resetCliResolution();
        // Which languages can be drawn is the analyzer's answer, so a
        // different analyzer may give a different one.
        resetControlFlowSupport();
        primeControlFlowSupport(context, output, () => state.fireAnalysisChanged());
      }
      if (e.affectsConfiguration("clarifydoc.storage")) {
        resetStorageResolution();
        logStorage();
      }
      state.refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      resetStorageResolution();
      state.refresh();
    }),
    // Trust unlocks writing into the project, which is where the analysis goes
    // by default — re-probe rather than staying in the fallback layout.
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      resetStorageResolution();
      logStorage();
      state.refresh();
    }),
  );

  // Publish the analysis to AI agents over MCP (VS Code 1.101+; no-op below
  // that, where "Copy MCP Server Config" covers external agents).
  registerMcpProvider(state);

  // Debounced auto re-analysis via a FileSystemWatcher (opt-in: analyzeOnSave).
  registerAutoAnalyze(state, (folder) => analyzeWorkspace(state, folder, { quiet: true }));

  // The analyzer is bundled inside the extension; warn once if the bundle is
  // absent (e.g. running from source without `npm run bundle`) unless a custom
  // cliPath is configured.
  if (!bundleAvailable(context.extensionPath) && !getConfig().cliPath) {
    output.warn(
      "bundled analyzer not found at clarifydoc/dist/cli.js — run `npm run bundle`, or set clarifydoc.cliPath.",
    );
  }

  // Where each folder's analysis lives, so the output log explains it without
  // the user having to go looking.
  logStorage();

  // Offer to wire up external agents, once, in a workspace that already has
  // MCP configured: the first folder that qualifies, never more than one offer.
  void (async () => {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (await maybeOfferMcpInstall(state, folder)) break;
    }
  })();

  // Populate the views from any existing on-disk analysis.
  state.refresh();

  onboard(state);

  function logStorage(): void {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const { mode, reason } = storageFor(folder);
      output.info(
        `[storage] ${folder.name}: ${mode}${reason ? ` (${reason})` : ""} — ` +
          `analysis in ${outputBaseDir(context, folder)}`,
      );
    }
  }
}

export function deactivate(): void {
  // An analysis outliving its window would keep writing into a workspace no
  // one is looking at; everything else is a disposable registered above.
  killAllChildren();
}
