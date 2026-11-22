import * as vscode from "vscode";
import { headAlreadySeen } from "./analysisData";
import { HEAD_FILE } from "./summaryHead";
import { resultsDir } from "./paths";
import { ExtensionState } from "./state";

/** The analyzer writes the head last: a change to it is the analysis being complete. */
const DEBOUNCE_MS = 400;

/**
 * Watches each folder's `summary-head.json` (not the summary, which is written
 * before the manifest and the head) so an analysis written from outside the
 * window — a CLI run in a terminal, a CI step, another window — refreshes the
 * views. A write the window's own analysis made is announced by that analysis
 * already: the head's mtime then matches one a load has read, and nothing more
 * is announced.
 */
export function registerHeadWatch(state: ExtensionState): void {
  let watchers: vscode.Disposable[] = [];
  const timers = new Map<string, NodeJS.Timeout>();

  const rebuild = () => {
    watchers.forEach((w) => w.dispose());
    watchers = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const pattern = new vscode.RelativePattern(vscode.Uri.file(resultsDir(state.context, folder)), HEAD_FILE);
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const changed = () => {
        const key = folder.uri.fsPath;
        clearTimeout(timers.get(key));
        timers.set(
          key,
          setTimeout(() => {
            timers.delete(key);
            if (state.isRunning(key)) return; // the run announces itself when it ends
            void headAlreadySeen(state.context, folder).then((seen) => {
              if (!seen) state.fireAnalysisChanged();
            });
          }, DEBOUNCE_MS),
        );
      };
      watchers.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed));
    }
  };
  rebuild();
  state.context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(rebuild),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("clarifydoc.storage")) rebuild();
    }),
    {
      dispose: () => {
        watchers.forEach((w) => w.dispose());
        timers.forEach((t) => clearTimeout(t));
      },
    },
  );
}
