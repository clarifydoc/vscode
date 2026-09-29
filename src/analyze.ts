import * as vscode from "vscode";
import { getConfig } from "./config";
import { resolveCli, runClarifyDoc, reportSpawnError } from "./cli";
import { outputBaseDir, ensureOutputDir } from "./paths";
import { ExtensionState } from "./state";
import { showReport } from "./report";
import { pickWorkspaceFolder } from "./workspace";

export interface AnalyzeOptions {
  /** Force a full (non-incremental) re-scan regardless of the setting. */
  fullRescan?: boolean;
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
    void vscode.window.showInformationMessage(
      `ClarifyDoc is already analyzing ${folder.name}.`,
    );
    return;
  }

  const cli = resolveCli(state.context.extensionPath);
  const cfg = getConfig(folder.uri);
  const args = buildAnalyzeArgs(state.context, folder, opts);

  state.output.appendLine("");
  state.output.appendLine(`── Analyze ${folder.name} ─────────────────────────`);
  state.output.appendLine(`CLI:  ${cli.display}`);
  state.output.appendLine(`Args: ${args.join(" ")}`);

  await ensureOutputDir(state.context, folder);

  state.setRunning(folderPath, true);
  state.refresh();

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `ClarifyDoc: analyzing ${folder.name}`,
        cancellable: true,
      },
      async (progress, token) => {
        const lspFailures: string[] = [];
        const result = await runClarifyDoc(cli, args, {
          cwd: folderPath,
          token,
          onOutput: (chunk) => {
            state.output.append(chunk);
            // The analyzer only warns when a language server cannot start and
            // then continues without it; when the user asked for LSP, that is
            // a result they need to see, not a line in the output channel.
            for (const m of chunk.matchAll(/Failed to start LSP server '([^']+)'/g)) lspFailures.push(m[1]);
            if (/Docker is not available/.test(chunk)) lspFailures.push("docker");
            const line = lastMeaningfulLine(chunk);
            if (line) progress.report({ message: line });
          },
        }).catch((err) => reportSpawnError(err, cli));

        if (!result) return; // cancelled or spawn error already surfaced

        if (cfg.enableLsp && lspFailures.length > 0) {
          const what = lspFailures.includes("docker")
            ? "Docker is not available"
            : `the ${[...new Set(lspFailures)].join(", ")} language server(s) failed to start`;
          void vscode.window
            .showWarningMessage(
              `ClarifyDoc: LSP enhancement was skipped — ${what}. The analysis completed without it.`,
              "Show Output",
            )
            .then((choice) => {
              if (choice === "Show Output") state.output.show(true);
            });
        }

        if (result.code !== 0) {
          state.output.show(true);
          void vscode.window.showErrorMessage(
            `ClarifyDoc analysis failed (exit ${result.code}). See the ClarifyDoc output for details.`,
          );
          return;
        }

        state.refresh();
        state.fireAnalysisChanged();

        if (cfg.openReportAfterAnalyze) {
          progress.report({ message: "generating report…" });
          await showReport(state, folder, { force: true, cli });
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
