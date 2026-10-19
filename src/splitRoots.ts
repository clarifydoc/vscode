import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { loadAnalysis, loadAnalyzer } from "./analysisData";
import { ExtensionState } from "./state";
import { commonParent, findSplitTiers, type RouteLinker, type SplitTier, type TierFolder } from "./splitTiers";

/** The parent the user chose to reopen on, analyzed once the new window activates. */
const PENDING = "clarifydoc.splitRoots.analyzeOnOpen";
/** Folder sets the user declined, so the offer is made once per set. */
const DECLINED = "clarifydoc.splitRoots.declined.v1";

/**
 * VSCODE 8.5: when a call in one workspace folder is served by a route in
 * another, say so — each folder's analysis cannot link them — and offer to
 * reopen on the folders' common parent and analyze it as one map. Linking
 * separately analyzed repositories stays in the app; this only points at the
 * one analysis that sees both sides.
 */
export function registerSplitRoots(state: ExtensionState): void {
  const { context } = state;

  // The window this offer reopened: analyze the parent now, once.
  const pending = context.globalState.get<string>(PENDING);
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (pending) {
    void context.globalState.update(PENDING, undefined);
    if (folders.length === 1 && path.resolve(folders[0]!.uri.fsPath) === path.resolve(pending)) {
      void vscode.commands.executeCommand("clarifydoc.analyze", folders[0]);
    }
  }

  let timer: NodeJS.Timeout | undefined;
  let offered = false;
  context.subscriptions.push(
    state.onAnalysisChanged(() => {
      if (offered || (vscode.workspace.workspaceFolders ?? []).length < 2) return;
      clearTimeout(timer);
      timer = setTimeout(() => void check(state).then((found) => (offered = found.length > 0 ? offerOnce(state, found) : offered)), 3000);
    }),
    { dispose: () => clearTimeout(timer) },
    // For tests and the curious: what the check finds now, without the offer.
    vscode.commands.registerCommand("clarifydoc.internal.splitTiers", () => check(state)),
  );
}

async function check(state: ExtensionState): Promise<Array<SplitTier & { parent?: string }>> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length < 2) return [];
  const analyzer = (await loadAnalyzer(state.context)) as { linkApiCallsToRoutesDetailed?: RouteLinker } | undefined;
  const link = analyzer?.linkApiCallsToRoutesDetailed;
  // An analyzer older than the export cannot say; nothing is guessed in its place.
  if (!link) return [];
  const tiers: TierFolder[] = [];
  for (const f of folders) {
    const a = await loadAnalysis(state.context, f);
    if (!a) continue;
    tiers.push({ name: f.name, root: f.uri.fsPath, misses: [...a.crossTier.missesByFile.values()].flat(), routes: a.routes });
  }
  const byName = new Map(folders.map((f) => [f.name, f.uri.fsPath]));
  return findSplitTiers(tiers, (calls, routes) => link(calls, routes)).map((s) => ({
    ...s,
    parent: commonParent([byName.get(s.caller)!, byName.get(s.server)!], os.homedir()),
  }));
}

function offerOnce(state: ExtensionState, found: Array<SplitTier & { parent?: string }>): boolean {
  const { context, output } = state;
  for (const s of found) {
    output.info(`[split roots] ${s.calls} call(s) in ${s.caller} reach routes in ${s.server}, a different workspace folder — each folder is analyzed alone, so they stay unlinked. e.g. ${s.examples.join("; ")}`);
  }
  const top = found[0]!;
  const key = [...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)].sort().join("|");
  const declined = context.globalState.get<string[]>(DECLINED) ?? [];
  if (declined.includes(key) || context.extensionMode === vscode.ExtensionMode.Test) return true;

  const parent = top.parent;
  const msg =
    `ClarifyDoc: ${top.calls} call${top.calls === 1 ? "" : "s"} in ${top.caller} reach routes in ${top.server}, but each workspace folder is analyzed alone, so they show as unlinked.` +
    (parent ? ` Analyze their common parent, ${parent.replace(os.homedir(), "~")}, as one map?` : " They share no parent that could be analyzed as one project.");
  const actions = parent ? ["Open Parent and Analyze", "Not Now", "Don't Ask Again"] : ["Don't Ask Again"];
  void vscode.window.showInformationMessage(msg, ...actions).then(async (choice) => {
    if (choice === "Don't Ask Again") await context.globalState.update(DECLINED, [...declined, key]);
    if (choice === "Open Parent and Analyze" && parent) {
      await context.globalState.update(PENDING, parent);
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(parent), { forceNewWindow: false });
    }
  });
  return true;
}
