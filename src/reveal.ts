import * as vscode from "vscode";
import * as path from "path";

/**
 * Open a source file in the editor and move the cursor to `line` (1-based, as the
 * analyzer emits). Reveals in the center. `viewColumn` lets callers open beside
 * another view (e.g. next to the report webview).
 */
export async function openSourceAt(
  absPath: string,
  line?: number,
  viewColumn?: vscode.ViewColumn,
): Promise<void> {
  const uri = vscode.Uri.file(absPath);
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: true, viewColumn });
    if (line !== undefined && line > 0) {
      const pos = new vscode.Position(Math.max(0, line - 1), 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
  } catch {
    void vscode.window.showWarningMessage(`ClarifyDoc: could not open ${absPath}`);
  }
}

/** Absolute path for a project-relative file within a folder. */
export function absFor(folder: vscode.WorkspaceFolder, relFile: string): string {
  return path.join(folder.uri.fsPath, relFile);
}
