import * as vscode from "vscode";
import { getConfig } from "./config";
import { ExtensionState } from "./state";
import { resolveCli, ResolvedCli, runClarifyDoc } from "./cli";
import { sourceGlobFrom } from "./sourceGlob";
import { freshnessOf } from "./analysisData";
import { decideSaveLoop, type SaveLoop } from "./saveLoop";

// Used only when the analyzer cannot say what it reads (an older CLI set
// through clarifydoc.cliPath): the languages it has always supported.
const FALLBACK_GLOB =
  "**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte,py,java,kt,kts,cs,php,go,rs,rb,swift,dart,scala,pas,dpr,sql,prisma}";

/** The last real analysis time per folder path, in ms. */
const TIMES = "clarifydoc.analysisMs.v1";

export function lastAnalysisTime(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): number | undefined {
  return context.workspaceState.get<Record<string, number>>(TIMES)?.[folder.uri.fsPath];
}

export async function recordAnalysisTime(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder, ms: number): Promise<void> {
  const all = context.workspaceState.get<Record<string, number>>(TIMES) ?? {};
  await context.workspaceState.update(TIMES, { ...all, [folder.uri.fsPath]: ms });
}

export function saveLoopFor(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): SaveLoop {
  return decideSaveLoop(getConfig(folder.uri).analyzeOnSave, lastAnalysisTime(context, folder));
}

/** Anything ClarifyDoc itself wrote — never a reason to re-analyze. */
function isAnalysisArtifact(uri: vscode.Uri): boolean {
  return /[\\/]\.clarifydoc(-viewer)?[\\/]/.test(uri.fsPath);
}

let globMemo: { cli: ResolvedCli; glob: Promise<string[]> } | undefined;

/** Every file the analyzer reads, asked of the analyzer once per CLI resolution. */
async function sourceGlobs(state: ExtensionState): Promise<string[]> {
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
      return [FALLBACK_GLOB];
    },
    () => [FALLBACK_GLOB],
  );
  globMemo = { cli, glob };
  return glob;
}

/**
 * Auto-re-analysis driven by a `FileSystemWatcher` (a superset of save events —
 * it also catches external edits, branch switches, generated files). Per
 * folder by `clarifydoc.analyzeOnSave` — `auto` by default, on where the last
 * analysis was quick, re-judged after every analysis; debounced per folder,
 * shorter on a quick one. When it starts it also
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

  let enabledKey = "";
  const loops = () => (vscode.workspace.workspaceFolders ?? []).map((f) => ({ folder: f, loop: saveLoopFor(state.context, f) }));

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
      }, saveLoopFor(state.context, folder).debounceMs),
    );
  };

  const rebuild = async () => {
    const mine = ++generation;
    watchers.forEach((w) => w.dispose());
    watchers.length = 0;
    const all = loops();
    enabledKey = all.filter((l) => l.loop.on).map((l) => l.folder.uri.fsPath).join("|");
    for (const { folder, loop } of all) state.output.info(`[watch] ${folder.name}: save loop ${loop.on ? "on" : "off"} (${loop.why})`);
    const folders = all.filter((l) => l.loop.on).map((l) => l.folder);
    if (folders.length === 0) return;
    const globs = await sourceGlobs(state);
    if (mine !== generation) return; // rebuilt again while asking the analyzer
    for (const folder of folders) {
      const onChange = (changed: vscode.Uri) => {
        if (!isAnalysisArtifact(changed)) schedule(folder);
      };
      for (const glob of globs) {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, glob));
        watcher.onDidChange(onChange);
        watcher.onDidCreate(onChange);
        watcher.onDidDelete(onChange);
        watchers.push(watcher);
      }
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
    // `auto` is re-judged by each analysis's time: rebuild only when that turned a folder on or off.
    state.onAnalysisChanged(() => {
      const key = loops().filter((l) => l.loop.on).map((l) => l.folder.uri.fsPath).join("|");
      if (key !== enabledKey) void rebuild();
    }),
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
