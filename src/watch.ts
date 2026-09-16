import * as vscode from "vscode";
import { getConfig } from "./config";
import { ExtensionState } from "./state";

// Source files worth re-analyzing on change. Kept to the analyzer's supported
// languages so the watcher doesn't fire on assets/output.
const SRC_GLOB =
  "**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte,py,java,kt,kts,cs,php,go,rs,rb,swift,dart,scala,pas,dpr,sql,prisma}";

const DEBOUNCE_MS = 2500;

/** Anything ClarifyDoc itself wrote — never a reason to re-analyze. */
function isAnalysisArtifact(uri: vscode.Uri): boolean {
  return /[\\/]\.clarifydoc(-viewer)?[\\/]/.test(uri.fsPath);
}

/**
 * Auto-re-analysis driven by a `FileSystemWatcher` (a superset of save events —
 * it also catches external edits, branch switches, generated files). Opt-in via
 * `clarifydoc.analyzeOnSave`; debounced per folder; skipped while a run is in
 * flight.
 *
 * Analyzer output now lands in `.clarifydoc/` inside the workspace, and the
 * report viewer unpacks .js assets in there — which SRC_GLOB matches. Changes
 * under that directory are therefore ignored explicitly, or a re-analysis would
 * re-trigger the watcher and never stop.
 */
export function registerAutoAnalyze(
  state: ExtensionState,
  run: (folder: vscode.WorkspaceFolder) => void,
): void {
  const watchers: vscode.Disposable[] = [];
  const timers = new Map<string, NodeJS.Timeout>();

  const rebuild = () => {
    watchers.forEach((w) => w.dispose());
    watchers.length = 0;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (!getConfig(folder.uri).analyzeOnSave) continue;
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, SRC_GLOB),
      );
      const schedule = (changed: vscode.Uri) => {
        if (isAnalysisArtifact(changed)) return;
        const key = folder.uri.fsPath;
        if (state.isRunning(key)) return;
        clearTimeout(timers.get(key));
        timers.set(
          key,
          setTimeout(() => {
            timers.delete(key);
            run(folder);
          }, DEBOUNCE_MS),
        );
      };
      watcher.onDidChange(schedule);
      watcher.onDidCreate(schedule);
      watcher.onDidDelete(schedule);
      watchers.push(watcher);
    }
  };

  rebuild();
  state.context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("clarifydoc.analyzeOnSave")) rebuild();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => rebuild()),
    { dispose: () => watchers.forEach((w) => w.dispose()) },
  );
}
