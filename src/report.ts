import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { resolveCli, runClarifyDoc, reportSpawnError, ResolvedCli } from "./cli";
import { resultsDir, reportPath, summaryPath } from "./paths";
import { getConfig } from "./config";
import { ExtensionState } from "./state";
import { openReport as openReportInEditor, refreshOpenReport } from "./reportPanel";

async function statMs(p: string): Promise<number | undefined> {
  try {
    return (await fs.stat(p)).mtimeMs;
  } catch {
    return undefined;
  }
}

/** Version of the bundled viewer that last generated report.html for a folder. */
function extensionVersion(state: ExtensionState): string {
  return (state.context.extension?.packageJSON?.version as string) ?? "0";
}
function stampPath(state: ExtensionState, folder: vscode.WorkspaceFolder): string {
  return path.join(resultsDir(state.context, folder), ".clarifydoc-viewer");
}
async function stampMatches(state: ExtensionState, folder: vscode.WorkspaceFolder): Promise<boolean> {
  try {
    return (await fs.readFile(stampPath(state, folder), "utf8")).trim() === extensionVersion(state);
  } catch {
    return false;
  }
}

/**
 * Make sure `report.html` exists and is at least as fresh as
 * `project-summary.json`, regenerating it via the CLI when it is missing, stale,
 * or when `force` is set (e.g. right after a re-analysis). Returns whether a
 * usable report is present afterwards.
 */
export async function ensureReport(
  state: ExtensionState,
  folder: vscode.WorkspaceFolder,
  opts: { force?: boolean; cli?: ResolvedCli } = {},
): Promise<boolean> {
  const summaryMs = await statMs(summaryPath(state.context, folder));
  if (summaryMs === undefined) {
    const choice = await vscode.window.showWarningMessage(
      `ClarifyDoc: analyze ${folder.name} first.`,
      "Analyze Workspace",
    );
    if (choice === "Analyze Workspace") {
      await vscode.commands.executeCommand("clarifydoc.analyze", folder);
    }
    return false;
  }

  const reportMs = await statMs(reportPath(state.context, folder));
  // Regenerate when missing, stale vs the summary, forced, OR when the report was
  // produced by an older bundled viewer — otherwise a report.html built before a
  // feature (e.g. file deep-links) lands would silently ignore it.
  const needed =
    opts.force === true ||
    reportMs === undefined ||
    reportMs < summaryMs ||
    !(await stampMatches(state, folder));
  if (!needed) return true;

  const cli = opts.cli ?? resolveCli(state.context.extensionPath);
  const result = await runClarifyDoc(cli, ["report", resultsDir(state.context, folder), "--no-open"], {
    cwd: folder.uri.fsPath,
    onOutput: (c) => state.output.append(c),
  }).catch((err) => reportSpawnError(err, cli));

  if (!result) return false;
  if (result.code !== 0) {
    state.output.show(true);
    void vscode.window.showErrorMessage(
      "ClarifyDoc: could not generate the report. See the ClarifyDoc output.",
    );
    return false;
  }
  await fs.writeFile(stampPath(state, folder), extensionVersion(state)).catch(() => {});
  await refreshOpenReport(state.context, folder);
  return true;
}

/**
 * Ensure the report is up to date, then show it — in an editor webview or the
 * external browser, per the `clarifydoc.reportLocation` setting (overridable).
 */
export async function showReport(
  state: ExtensionState,
  folder: vscode.WorkspaceFolder,
  opts: {
    force?: boolean;
    cli?: ResolvedCli;
    location?: "editor" | "browser";
    /** Deep-link into the report, e.g. "traces~src/foo.ts" (tab, optional ~file). */
    hash?: string;
  } = {},
): Promise<void> {
  if (!(await ensureReport(state, folder, { force: opts.force, cli: opts.cli }))) return;

  const location = opts.location ?? getConfig(folder.uri).reportLocation;
  if (location === "browser") {
    const uri = vscode.Uri.file(reportPath(state.context, folder));
    await vscode.env.openExternal(opts.hash ? uri.with({ fragment: opts.hash }) : uri);
  } else {
    await openReportInEditor(state, folder, opts.hash);
  }
}
