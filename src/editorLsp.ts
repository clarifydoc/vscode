import * as vscode from "vscode";
import * as path from "path";
import { promises as fs } from "fs";
import { getConfig } from "./config";
import { resolveCli, runClarifyDoc, reportSpawnError, type ResolvedCli } from "./cli";
import { resultsDir, summaryPath } from "./paths";
import { ExtensionState } from "./state";
import { ensureReport } from "./report";
import { hasOpenReport } from "./reportPanel";
import { pickWorkspaceFolder } from "./workspace";
import { DEFAULT_LIMITS, runDefinitionPass, withEditorPass, type DefinitionQuery, type ProviderLocation } from "./editorLspCore";

/** How long the language servers get to load the project before the first question. */
const WARMUP_MS = 3000;

/** The pass running per folder, so a new analysis can stop a pass over the old one. */
const running = new Map<string, vscode.CancellationTokenSource>();

/** Stop a pass over this folder's analysis — it is about to be replaced. */
export function cancelEditorPass(folder: vscode.WorkspaceFolder): void {
  running.get(folder.uri.fsPath)?.cancel();
}

export interface EditorPassOptions {
  /** After an automatic analysis: status-bar progress, no toasts. */
  quiet?: boolean;
  cli?: ResolvedCli;
}

/**
 * Layer 2 without Docker: the language servers this editor already runs
 * answer where the calls the text linker could not resolve lead. The
 * analyzer lists the questions, the editor's definition providers answer
 * them within a budget, and the analyzer merges the unambiguous answers as
 * layer-2 links (`lsp-update --answers`). Nothing is asked of a server the
 * editor does not have.
 */
export async function resolveWithEditor(
  state: ExtensionState,
  target?: vscode.WorkspaceFolder | vscode.Uri,
  opts: EditorPassOptions = {},
): Promise<void> {
  const folder = await pickWorkspaceFolder(target);
  if (!folder) return;
  if (!vscode.workspace.isTrusted) return;
  try {
    await fs.access(summaryPath(state.context, folder));
  } catch {
    if (!opts.quiet) void vscode.window.showInformationMessage("ClarifyDoc: analyze the workspace first.");
    return;
  }
  const key = folder.uri.fsPath;
  running.get(key)?.cancel();
  const source = new vscode.CancellationTokenSource();
  running.set(key, source);
  const cli = opts.cli ?? (await resolveCli(state.context.extensionPath));
  const dir = resultsDir(state.context, folder);
  const queriesFile = path.join(dir, "editor-queries.json");
  const answersFile = path.join(dir, "editor-answers.json");
  const cfg = getConfig(folder.uri);
  const projectRoot = folder.uri.fsPath;

  try {
    await vscode.window.withProgress(
      {
        location: opts.quiet ? vscode.ProgressLocation.Window : vscode.ProgressLocation.Notification,
        title: "ClarifyDoc: resolving calls with the editor's language servers",
        cancellable: !opts.quiet,
      },
      async (progress, token) => {
        const sub = token.onCancellationRequested(() => source.cancel());
        try {
          const emit = await runClarifyDoc(cli, ["lsp-update", dir, "--project-root", projectRoot, "--emit-queries", queriesFile], {
            cwd: projectRoot,
            token: source.token,
          }).catch((err) => (err instanceof vscode.CancellationError ? undefined : reportSpawnError(err, cli)));
          if (!emit || emit.code !== 0) {
            if (emit) state.output.warn(`editor language servers: could not list the questions (exit ${emit.code}) ${emit.stderr.trim()}`);
            return;
          }
          const { queries } = JSON.parse(await fs.readFile(queriesFile, "utf-8")) as { queries: DefinitionQuery[] };
          if (queries.length === 0) {
            state.output.info("editor language servers: every call is already resolved");
            return;
          }
          // Servers start when a document of their language opens, and load the
          // project before they answer: open one file per language, then give
          // them a moment. What they still say nothing to is asked again.
          const firstOf = new Map<string, string>();
          for (const q of queries) if (!firstOf.has(q.language)) firstOf.set(q.language, q.file);
          for (const file of [...firstOf.values()].slice(0, 12)) {
            await Promise.resolve(vscode.workspace.openTextDocument(vscode.Uri.file(path.join(projectRoot, file)))).catch(() => undefined);
          }
          progress.report({ message: "waiting for the language servers…" });
          await new Promise((r) => setTimeout(r, WARMUP_MS));
          if (source.token.isCancellationRequested) return;
          const started = Date.now();
          let done = 0;
          const limits = { ...DEFAULT_LIMITS, maxQueries: cfg.editorLspMaxQueries };
          const total = Math.min(queries.length, limits.maxQueries);
          const pass = await withEditorPass(() =>
            runDefinitionPass(
              queries,
              async (q) => {
                const uri = vscode.Uri.file(path.join(projectRoot, q.file));
                const res = await vscode.commands.executeCommand<ProviderLocation[] | undefined>(
                  "vscode.executeDefinitionProvider",
                  uri,
                  new vscode.Position(q.line - 1, q.column),
                );
                if (++done % 50 === 0) progress.report({ message: `${done}/${total}` });
                return res;
              },
              projectRoot,
              limits,
              () => source.token.isCancellationRequested,
            ),
          );
          if (pass.stopped === "cancelled") return;
          const servers = pass.languages.map((l) => `${l} (editor)`);
          await fs.writeFile(answersFile, JSON.stringify({ source: "editor", servers, answers: pass.answers }));
          progress.report({ message: "merging…" });
          const merge = await runClarifyDoc(cli, ["lsp-update", dir, "--project-root", projectRoot, "--answers", answersFile], {
            cwd: projectRoot,
            token: source.token,
          }).catch((err) => (err instanceof vscode.CancellationError ? undefined : reportSpawnError(err, cli)));
          if (!merge) return;
          if (merge.code !== 0) {
            state.output.warn(`editor language servers: merge failed (exit ${merge.code}) ${merge.stderr.trim()}`);
            return;
          }
          const added = Number(/\+Defs:\s+(\d+)/.exec(merge.stdout)?.[1] ?? 0);
          const abstained = Number(/(\d+) ambiguous answers abstained/.exec(merge.stdout)?.[1] ?? 0);
          const parts = [
            `${pass.asked} of ${queries.length} unresolved calls asked`,
            `${pass.answered} answered inside the project`,
            `+${added} links`,
            abstained ? `${abstained} ambiguous left out` : "",
            pass.timeouts ? `${pass.timeouts} timed out` : "",
            pass.retried ? `${pass.retried} re-asked after warm-up` : "",
            pass.gaveUp.length ? `gave up on ${pass.gaveUp.join(", ")}` : "",
            pass.stopped ? `stopped at the ${pass.stopped}` : "",
          ].filter(Boolean);
          state.output.info(`editor language servers (${((Date.now() - started) / 1000).toFixed(1)}s): ${parts.join(", ")}`);
          state.fireAnalysisChanged();
          state.refresh();
          if (hasOpenReport(folder)) await ensureReport(state, folder, { force: true, cli, token: source.token });
          if (!opts.quiet) void vscode.window.showInformationMessage(`ClarifyDoc: +${added} call links from the editor's language servers.`);
        } finally {
          sub.dispose();
        }
      },
    );
  } finally {
    if (running.get(key) === source) running.delete(key);
    source.dispose();
    await fs.rm(queriesFile, { force: true });
    await fs.rm(answersFile, { force: true });
  }
}

/** After a successful analysis: run the pass when it is on and Docker LSP is not. */
export function maybeResolveWithEditor(state: ExtensionState, folder: vscode.WorkspaceFolder, cli: ResolvedCli): void {
  const cfg = getConfig(folder.uri);
  if (!cfg.editorLsp || cfg.enableLsp) return;
  void resolveWithEditor(state, folder, { quiet: true, cli }).catch((err) => state.output.warn(`editor language servers: ${(err as Error).message}`));
}
