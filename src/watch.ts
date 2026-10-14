import * as vscode from "vscode";
import { getConfig } from "./config";
import { ExtensionState } from "./state";
import { resolveCli, ResolvedCli, runClarifyDoc } from "./cli";
import { sourceGlobFrom } from "./sourceGlob";
import { freshnessOf } from "./analysisData";

// Used only when the analyzer cannot say what it reads (an older CLI set
// through clarifydoc.cliPath): the languages it has always supported.
const FALLBACK_GLOB =
  "**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte,py,java,kt,kts,cs,php,go,rs,rb,swift,dart,scala,pas,dpr,sql,prisma}";

const DEBOUNCE_MS = 2500;

/** Anything ClarifyDoc itself wrote — never a reason to re-analyze. */
function isAnalysisArtifact(uri: vscode.Uri): boolean {
  return /[\\/]\.clarifydoc(-viewer)?[\\/]/.test(uri.fsPath);
}

let globMemo: { cli: ResolvedCli; glob: Promise<string> } | undefined;

/** Every file the analyzer reads, asked of the analyzer once per CLI resolution. */
async function sourceGlob(state: ExtensionState): Promise<string> {
  const cli = await resolveCli(state.context.extensionPath);
  if (globMemo?.cli === cli) return globMemo.glob;
  const glob = runClarifyDoc(cli, ["detect", "--json"], { cwd: state.context.extensionPath }).then(
    (result) => {
      try {
        if (result.code === 0) {
          const glob = sourceGlobFrom(JSON.parse(result.stdout));
          if (glob) return glob;
        }
      } catch {
        /* not JSON: an analyzer from before `detect --json` */
      }
      state.output.warn("[watch] the analyzer did not list its file types; watching the common languages only");
      return FALLBACK_GLOB;
    },
    () => FALLBACK_GLOB,
  );
  globMemo = { cli, glob };
  return glob;
}

/**
 * Auto-re-analysis driven by a `FileSystemWatcher` (a superset of save events —
 * it also catches external edits, branch switches, generated files). Opt-in via
 * `clarifydoc.analyzeOnSave`; debounced per folder. When it starts it also
 * re-analyzes a folder whose analysis no longer matches its files. A change that arrives while
 * the folder is being analyzed is not lost: one more run follows when the
 * current one ends.
 *
 * Analyzer output lands in `.clarifydoc/` inside the workspace, and the report
 * viewer unpacks .js assets in there — which the source glob matches. Changes
 * under that directory are therefore ignored explicitly, or a re-analysis would
 * re-trigger the watcher and never stop.
 */
export function registerAutoAnalyze(
  state: ExtensionState,
  run: (folder: vscode.WorkspaceFolder) => Promise<void>,
): void {
  const watchers: vscode.Disposable[] = [];
  const timers = new Map<string, NodeJS.Timeout>();
  /** Folders changed while their analysis was running. */
  const pending = new Set<string>();
  let generation = 0;

  const schedule = (folder: vscode.WorkspaceFolder) => {
    const key = folder.uri.fsPath;
    if (state.isRunning(key)) {
      pending.add(key);
      return;
    }
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        void run(folder).finally(() => {
          if (pending.delete(key)) schedule(folder);
        });
      }, DEBOUNCE_MS),
    );
  };

  const rebuild = async () => {
    const mine = ++generation;
    watchers.forEach((w) => w.dispose());
    watchers.length = 0;
    const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => getConfig(f.uri).analyzeOnSave);
    if (folders.length === 0) return;
    const glob = await sourceGlob(state);
    if (mine !== generation) return; // rebuilt again while asking the analyzer
    for (const folder of folders) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, glob));
      const onChange = (changed: vscode.Uri) => {
        if (!isAnalysisArtifact(changed)) schedule(folder);
      };
      watcher.onDidChange(onChange);
      watcher.onDidCreate(onChange);
      watcher.onDidDelete(onChange);
      watchers.push(watcher);
      // The watcher only sees changes from now on. Catch up on the ones made
      // while VS Code was closed (a pull, a branch switch), or on an analyzer
      // update, once — never for a folder that has no analysis yet: that one
      // gets the first-open offer instead.
      void freshnessOf(state.context, folder).then((report) => {
        if (mine !== generation) return;
        if (report?.state === "changed" || report?.state === "extractor-changed") {
          state.output.info(`[watch] ${folder.name}: the analysis is out of date (${report.state}) — re-analyzing`);
          schedule(folder);
        }
      });
    }
  };

  void rebuild();
  state.context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("clarifydoc.analyzeOnSave") ||
        e.affectsConfiguration("clarifydoc.cliPath") ||
        e.affectsConfiguration("clarifydoc.nodePath")
      ) {
        void rebuild();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void rebuild()),
    {
      dispose: () => {
        watchers.forEach((w) => w.dispose());
        timers.forEach((t) => clearTimeout(t));
      },
    },
  );
}
