import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { loadAnalysis, relPathOf } from "./analysisData";
import { blastPack } from "./blastCounts";

/** `clarifydoc.codeLens.blastThreshold`: direct dependents at or above which a file shows the lens; 0 turns it off. */
export function blastThreshold(uri: vscode.Uri): number {
  const n = vscode.workspace.getConfiguration("clarifydoc.codeLens", uri).get<number>("blastThreshold");
  return typeof n === "number" && n >= 0 ? n : 40;
}

/** "Check Blast Before Edit": the pack for the active file on the clipboard. */
export async function checkBlastBeforeEdit(state: ExtensionState, target?: vscode.Uri | string): Promise<void> {
  const uri = typeof target === "string" ? vscode.Uri.parse(target) : target ?? vscode.window.activeTextEditor?.document.uri;
  const folder = uri && vscode.workspace.getWorkspaceFolder(uri);
  const rel = uri && folder ? relPathOf(folder, uri) : undefined;
  if (!uri || !folder || !rel) {
    void vscode.window.showInformationMessage("ClarifyDoc: open a file inside an analyzed workspace folder first.");
    return;
  }
  const analysis = await loadAnalysis(state.context, folder);
  if (!analysis) {
    void vscode.window.showInformationMessage("ClarifyDoc: analyze the workspace first.");
    return;
  }
  await vscode.env.clipboard.writeText(blastPack(rel, analysis.blast?.get(rel)));
  vscode.window.setStatusBarMessage(`ClarifyDoc: blast pack for ${rel} copied`, 2500);
}
