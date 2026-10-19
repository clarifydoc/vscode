import * as vscode from "vscode";
import { bookmarkLabel, withBookmark, withoutBookmark, type Bookmark } from "./bookmarkModel";
import { showReport } from "./report";
import { currentReportView } from "./reportPanel";
import { ExtensionState } from "./state";

const KEY = "clarifydoc.bookmarks.v1";

export function bookmarksOf(state: ExtensionState, folder: vscode.WorkspaceFolder): Bookmark[] {
  return (state.context.workspaceState.get<Bookmark[]>(KEY) ?? []).filter((b) => b.folder === folder.uri.fsPath);
}

/**
 * VSCODE-PLAN 5.3: *Bookmark This View* names the place the open report is
 * at — its tab, section or focused file — and the sidebar lists it under
 * Bookmarks, one click from opening the report there again.
 */
export function registerBookmarks(state: ExtensionState): void {
  const { context } = state;
  const all = () => context.workspaceState.get<Bookmark[]>(KEY) ?? [];
  const save = async (list: Bookmark[]) => {
    await context.workspaceState.update(KEY, list);
    state.refresh();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("clarifydoc.bookmarkView", async (name?: string) => {
      const view = currentReportView();
      if (!view?.hash) {
        void vscode.window.showInformationMessage("ClarifyDoc: open the report at the view to bookmark first.");
        return;
      }
      const label = name ?? (await vscode.window.showInputBox({ prompt: "Name this view", value: bookmarkLabel(view.hash) }));
      if (!label?.trim()) return;
      await save(withBookmark(all(), { name: label.trim(), folder: view.folderPath, hash: view.hash }));
      vscode.window.setStatusBarMessage(`ClarifyDoc: bookmarked "${label.trim()}"`, 2500);
    }),
    vscode.commands.registerCommand("clarifydoc.openBookmark", async (b: Bookmark) => {
      const folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === b?.folder);
      if (folder) await showReport(state, folder, { hash: b.hash });
    }),
    vscode.commands.registerCommand("clarifydoc.deleteBookmark", async (node?: { bookmark?: Bookmark }) => {
      if (node?.bookmark) await save(withoutBookmark(all(), node.bookmark));
    }),
  );
}
