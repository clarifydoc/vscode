import * as vscode from "vscode";

/**
 * Choose the workspace folder to operate on. With a single folder there is no
 * choice; with several, ask (unless a specific folder was passed in, e.g. from
 * the explorer context menu).
 */
export async function pickWorkspaceFolder(
  preferred?: unknown,
): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage("ClarifyDoc: open a folder first.");
    return undefined;
  }

  // A command gets whatever its caller passed: a Uri from the explorer, a
  // folder from our own code — and from some menus an object that is neither,
  // which must not be taken for a folder.
  const uri =
    preferred instanceof vscode.Uri
      ? preferred
      : (preferred as { uri?: unknown } | undefined)?.uri instanceof vscode.Uri
        ? (preferred as vscode.WorkspaceFolder).uri
        : undefined;
  const preferredFolder = uri && vscode.workspace.getWorkspaceFolder(uri);
  if (preferredFolder) return preferredFolder;

  if (folders.length === 1) return folders[0];

  const pick = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
    { placeHolder: "Select a workspace folder to analyze" },
  );
  return pick?.folder;
}
