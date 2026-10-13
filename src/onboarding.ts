import * as vscode from "vscode";
import * as fs from "fs";
import { ExtensionState } from "./state";
import { summaryPath } from "./paths";

const WALKTHROUGH_SHOWN = "clarifydoc.walkthroughShown.v1";
const OFFERED = "clarifydoc.analyzeOffered.v1";
const WALKTHROUGH = "ClarifyDoc.clarifydoc-vscode#clarifydoc.gettingStarted";

/**
 * First contact: the walkthrough opens once after install; and a workspace
 * that has never been analyzed gets one quiet offer to analyze it, remembered
 * per workspace. Analysis never starts by itself.
 */
export function onboard(state: ExtensionState): void {
  const { context } = state;
  if (context.extensionMode === vscode.ExtensionMode.Test) return;

  if (!context.globalState.get(WALKTHROUGH_SHOWN)) {
    void context.globalState.update(WALKTHROUGH_SHOWN, true);
    // The walkthrough's first step is "Analyze": no separate offer this time.
    void vscode.commands.executeCommand("workbench.action.openWalkthrough", WALKTHROUGH, false);
    return;
  }

  if (context.workspaceState.get(OFFERED) || !vscode.workspace.isTrusted) return;
  const folders = vscode.workspace.workspaceFolders ?? [];
  const unanalyzed = folders.filter((f) => !fs.existsSync(summaryPath(context, f)));
  if (folders.length === 0 || unanalyzed.length !== folders.length) return;

  void context.workspaceState.update(OFFERED, true);
  void vscode.window
    .showInformationMessage(
      `Map ${folders.length === 1 ? folders[0].name : "this workspace"} with ClarifyDoc? It reads the code locally and writes only to .clarifydoc/.`,
      "Analyze",
      "Not Now",
    )
    .then((choice) => {
      // With several folders, the analyze command asks which.
      if (choice === "Analyze") void vscode.commands.executeCommand("clarifydoc.analyze", folders.length === 1 ? folders[0] : undefined);
    });
}
