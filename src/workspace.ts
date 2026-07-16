import * as vscode from "vscode";

/**
 * Choose the workspace folder to operate on. With a single folder there is no
 * choice; with several, ask (unless a specific folder was passed in, e.g. from
 * the explorer context menu).
 */
export async function pickWorkspaceFolder(
  preferred?: vscode.WorkspaceFolder | vscode.Uri,
): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage("ClarifyDoc: open a folder first.");
    return undefined;
  }

  if (preferred) {
    if (preferred instanceof vscode.Uri) {
      const f = vscode.workspace.getWorkspaceFolder(preferred);
      if (f) return f;
    } else {
      return preferred;
    }
  }

  if (folders.length === 1) return folders[0];

  const pick = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
    { placeHolder: "Select a workspace folder to analyze" },
  );
  return pick?.folder;
}
