import * as vscode from "vscode";
import { getConfig } from "./config";
import { resolveCli, runClarifyDoc, reportSpawnError } from "./cli";
import { outputBaseDir, ensureOutputDir } from "./paths";
import { ExtensionState } from "./state";
import { lineSink } from "./lineSink";
import { ensureReport, showReport } from "./report";
import { hasOpenReport, readLatestImpact } from "./reportPanel";
import { pickWorkspaceFolder } from "./workspace";
import { loadAnalysis } from "./analysisData";
import { thinMapNotes } from "./thinMap";
import { cancelEditorPass, maybeResolveWithEditor } from "./editorLsp";
import { isUpToDateRun } from "./saveLoop";
import { recordAnalysisTime } from "./watch";

const OUTPUT_FLUSH_MS = 250;

export interface AnalyzeOptions {
  /** Force a full (non-incremental) re-scan regardless of the setting. */
  fullRescan?: boolean;
  /**
   * An automatic run (analyze-on-save): progress in the status bar only, no
   * prompts or toasts on success, and the report is refreshed where it is
   * already open but never opened or revealed. Failures are still reported.
   */
  quiet?: boolean;
}

function buildAnalyzeArgs(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
  opts: AnalyzeOptions,
): string[] {
  const cfg = getConfig(folder.uri);
  const args = ["analyze", folder.uri.fsPath, "-o", outputBaseDir(context, folder)];

  if (!opts.fullRescan && cfg.incremental) args.push("--incremental");
  if (!cfg.enableLsp) args.push("--no-lsp");
  else if (cfg.lspTimeout > 0) args.push("--lsp-timeout", String(cfg.lspTimeout));
  if (!cfg.gitHistory) args.push("--no-git-history");
  if (cfg.maxFiles > 0) args.push("--max-files", String(cfg.maxFiles));
  if (cfg.includeGlobs.length) args.push("--include", ...cfg.includeGlobs);
  if (cfg.excludeGlobs.length) args.push("--exclude", ...cfg.excludeGlobs);
  args.push("--verbose");

  return args;
}

/**
 * Run `clarifydoc analyze` on a workspace folder with a cancellable progress
 * notification, then (optionally) generate and open the report.
 */
export async function analyzeWorkspace(
  state: ExtensionState,
  target?: vscode.WorkspaceFolder | vscode.Uri,
  opts: AnalyzeOptions = {},
): Promise<void> {
  const folder = await pickWorkspaceFolder(target);
  if (!folder) return;

  // The analyzer runs a bundled child process; require a trusted workspace.
  if (!vscode.workspace.isTrusted) {
    if (opts.quiet) return;
    const choice = await vscode.window.showWarningMessage(
      "ClarifyDoc needs a trusted workspace to run the analyzer.",
      "Manage Trust",
    );
    if (choice === "Manage Trust") {
      await vscode.commands.executeCommand("workbench.trust.manage");
    }
    return;
  }

  const folderPath = folder.uri.fsPath;
  if (state.isRunning(folderPath)) {
    if (opts.quiet) return;
    void vscode.window.showInformationMessage(
      `ClarifyDoc is already analyzing ${folder.name}.`,
    );
    return;
  }

  const cli = await resolveCli(state.context.extensionPath);
  const cfg = getConfig(folder.uri);
  const args = buildAnalyzeArgs(state.context, folder, opts);

  state.output.info(`── Analyze ${folder.name} ─────────────────────────`);
  state.output.info(`CLI:  ${cli.display}`);
  state.output.info(`Args: ${args.join(" ")}`);

  await ensureOutputDir(state.context, folder);

  state.setRunning(folderPath, true);
  state.refresh();
  // A pass over the analysis being replaced would merge into the new one.
  cancelEditorPass(folder);

  try {
    await vscode.window.withProgress(
      {
        location: opts.quiet ? vscode.ProgressLocation.Window : vscode.ProgressLocation.Notification,
        title: `ClarifyDoc: analyzing ${folder.name}`,
        cancellable: !opts.quiet,
      },
      async (progress, token) => {
        const lspFailures: string[] = [];
        // --verbose prints a line per file — hundreds of thousands on a big
        // tree — and each chunk passed on is a round-trip to the output channel
        // and the notification. Pass them on in batches instead.
        let pending = "";
        let timer: NodeJS.Timeout | undefined;
        const lines = lineSink((line) => state.output.info(line));
        // How long a real run takes is what decides whether the save loop is cheap enough to be on.
        const started = Date.now();
        let tail = "";
        let upToDate = false;
        const flush = () => {
          timer = undefined;
          if (!pending) return;
          lines.push(pending);
          const line = lastMeaningfulLine(pending.slice(-4096));
          if (line) progress.report({ message: line });
          pending = "";
        };
        const result = await runClarifyDoc(cli, args, {
          cwd: folderPath,
          token,
          captureStdout: false, // streamed to the output channel, never parsed
          onOutput: (chunk) => {
            // The analyzer only warns when a language server cannot start and
            // then continues without it; when the user asked for LSP, that is
            // a result they need to see, not a line in the output channel.
            for (const m of chunk.matchAll(/Failed to start LSP server '([^']+)'/g)) lspFailures.push(m[1]);
            if (/Docker is not available/.test(chunk)) lspFailures.push("docker");
            pending += chunk;
            tail = (tail + chunk).slice(-400);
            upToDate ||= isUpToDateRun(tail);
            timer ??= setTimeout(flush, OUTPUT_FLUSH_MS);
          },
        }).catch((err) => reportSpawnError(err, cli));
        clearTimeout(timer);
        flush();
        lines.end();

        if (!result) return; // cancelled or spawn error already surfaced

        if (cfg.enableLsp && lspFailures.length > 0) {
          const what = lspFailures.includes("docker")
            ? "Docker is not available"
            : `the ${[...new Set(lspFailures)].join(", ")} language server(s) failed to start`;
          const message = `LSP enhancement was skipped — ${what}. The analysis completed without it.`;
          // An automatic run repeats on every save; saying it once in the log is enough.
          if (opts.quiet) state.output.warn(message);
          else {
            void vscode.window.showWarningMessage(`ClarifyDoc: ${message}`, "Show Output").then((choice) => {
              if (choice === "Show Output") state.output.show(true);
            });
          }
        }

        if (result.code !== 0) {
          state.output.error(`analysis of ${folder.name} failed (exit ${result.code})`);
          if (!opts.quiet) state.output.show(true);
          void vscode.window.showErrorMessage(
            `ClarifyDoc analysis failed (exit ${result.code}). See the ClarifyDoc output for details.`,
          );
          return;
        }

        // An up-to-date exit costs nothing whatever the folder's size; it says nothing about a change.
        if (!upToDate) await recordAnalysisTime(state.context, folder, Date.now() - started);
        state.lines.reset(folder.uri);
        state.refresh();
        state.fireAnalysisChanged();
        maybeResolveWithEditor(state, folder, cli);

        // "Complete" is not "complete" when a framework the project depends on
        // left nothing on the map: say which, so an empty Routes list is not
        // read as "this project has no API".
        if (!opts.quiet) {
          const a = await loadAnalysis(state.context, folder);
          const notes = a ? thinMapNotes({ files: a.files.size, routes: a.routes.length, screens: a.screens.length, packages: a.packages }) : [];
          if (notes.length > 0) {
            state.output.warn(`analysis of ${folder.name}: ${notes.join("; ")}`);
            void vscode.window
              .showWarningMessage(`ClarifyDoc: analysis of ${folder.name} complete — but ${notes.join("; ")}.`, "Open Report", "Report a Gap")
              .then((choice) => {
                if (choice === "Open Report") void showReport(state, folder, { cli });
                if (choice === "Report a Gap") void vscode.commands.executeCommand("clarifydoc.reportIssue", { kind: "gap", folder, summary: notes[0] });
              });
            if (!cfg.openReportAfterAnalyze) return;
          }
        }

        if (opts.quiet) {
          // What this save reached, in the status bar for a moment.
          const impact = await readLatestImpact(state.context, folder);
          if (impact && impact.changedFiles.length) {
            const reach = [impact.routeCount ? `${impact.routeCount} route${impact.routeCount === 1 ? "" : "s"}` : "", impact.screenCount ? `${impact.screenCount} screen${impact.screenCount === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
            vscode.window.setStatusBarMessage(`$(pulse) ClarifyDoc: the last change reaches ${reach || "no route or screen"}`, 15_000);
          }
          // Keep an open report current; never open one unasked.
          if (hasOpenReport(folder)) await ensureReport(state, folder, { force: true, cli, token });
        } else if (cfg.openReportAfterAnalyze) {
          progress.report({ message: "generating report…" });
          await showReport(state, folder, { force: true, cli, token });
        } else {
          void vscode.window
            .showInformationMessage(
              `ClarifyDoc: analysis of ${folder.name} complete.`,
              "Open Report",
            )
            .then((choice) => {
              if (choice === "Open Report") void showReport(state, folder, { cli });
            });
        }
      },
    );
  } finally {
    state.setRunning(folderPath, false);
    state.refresh();
  }
}

function lastMeaningfulLine(chunk: string): string | undefined {
  const lines = chunk
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1].slice(0, 120) : undefined;
}
