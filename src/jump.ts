import * as vscode from "vscode";
import * as path from "path";
import { ExtensionState } from "./state";
import { showReport } from "./report";
import { loadAnalysis } from "./analysisData";

/** Report tabs an editor file can jump into, with a per-file focus. */
export type JumpTab = "ui" | "traces" | "blast" | "links" | "routes";

const TAB_LABEL: Record<JumpTab, string> = {
  ui: "Screens & UI",
  traces: "Call Traces",
  blast: "Blast Radius",
  links: "Architecture",
  routes: "Routes",
};

/**
 * Jump from the active editor to the report view for the current file. The
 * report keys files by their path relative to the analyzed root (the workspace
 * folder), with forward slashes — so we build that key and pass it as the
 * `#<tab>~<file>` deep-link the viewer understands.
 */
export async function jumpToFileView(state: ExtensionState, tab: JumpTab): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("ClarifyDoc: open a file in the editor first.");
    return;
  }

  const uri = editor.document.uri;
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    void vscode.window.showWarningMessage(
      "ClarifyDoc: this file is not inside an open workspace folder.",
    );
    return;
  }

  const rel = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/");
  const fileFocused = tab === "ui" || tab === "traces" || tab === "blast";
  const canFocus = fileFocused && !!rel && !rel.startsWith("..");

  // If the file isn't in the latest analysis, focusing would silently fall back
  // to the first entry — surface that instead of quietly opening the wrong thing.
  if (canFocus) {
    const registry = (await loadAnalysis(state.context, folder))?.files;
    if (registry?.size && !registry.has(rel)) {
      const choice = await vscode.window.showWarningMessage(
        `ClarifyDoc: "${rel}" isn't in the latest analysis of ${folder.name}. Re-analyze to include it?`,
        "Re-analyze",
        "Open Report Anyway",
      );
      if (choice === "Re-analyze") {
        await vscode.commands.executeCommand("clarifydoc.analyzeFull", folder);
        return;
      }
      if (choice !== "Open Report Anyway") return;
    }
  }

  const hash = canFocus ? `${tab}~${encodeURIComponent(rel)}` : tab;
  state.output.appendLine(`[jump] ${TAB_LABEL[tab]} → ${rel || "(file outside root)"}  (#${hash})`);
  await showReport(state, folder, { hash });
}
