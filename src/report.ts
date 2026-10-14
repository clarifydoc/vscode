import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { resolveCli, runClarifyDoc, reportSpawnError, ResolvedCli } from "./cli";
import { resultsDir, reportPath, summaryPath } from "./paths";
import { getConfig } from "./config";
import { ExtensionState } from "./state";
import { lineSink } from "./lineSink";
import { openReport as openReportInEditor, refreshOpenReport } from "./reportPanel";

async function statMs(p: string): Promise<number | undefined> {
  try {
    return (await fs.stat(p)).mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * What last generated report.html for a folder: the bundled viewer's version,
 * and the editor its file links open in (VS Code, Cursor, Windsurf… each have
 * their own URL scheme, and two of them can share one analysis).
 */
function extensionVersion(state: ExtensionState): string {
  return `${(state.context.extension?.packageJSON?.version as string) ?? "0"} ${vscode.env.uriScheme}`;
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
  opts: { force?: boolean; cli?: ResolvedCli; token?: vscode.CancellationToken } = {},
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

  const cli = opts.cli ?? (await resolveCli(state.context.extensionPath));
  const lines = lineSink((line) => state.output.info(line));
  // A report opened in a browser cannot know which editor sent it there; VS
  // Code itself is the default and needs no flag.
  const scheme = vscode.env.uriScheme;
  const args = ["report", resultsDir(state.context, folder), "--no-open"];
  const report = (token: vscode.CancellationToken, extra: string[]) =>
    runClarifyDoc(cli, [...args, ...extra], { cwd: folder.uri.fsPath, token, onOutput: (c) => lines.push(c) });
  const run = async (token: vscode.CancellationToken) => {
    try {
      if (scheme === "vscode") return await report(token, []);
      const first = await report(token, ["--editor-scheme", scheme]);
      // A CLI set through clarifydoc.cliPath may predate the flag.
      if (first.code !== 0 && /unknown option/i.test(first.stderr)) return await report(token, []);
      return first;
    } finally {
      lines.end();
    }
  };
  // Inside an analysis the caller's progress (and its Cancel) covers this run;
  // on its own it gets one, since a large report takes a while to build.
  const result = await (opts.token
    ? run(opts.token)
    : Promise.resolve(
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `ClarifyDoc: generating the report for ${folder.name}`,
            cancellable: true,
          },
          (_progress, token) => run(token),
        ),
      )
  ).catch((err) => reportSpawnError(err, cli));

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
    /** Cancels report generation; without one it gets its own progress. */
    token?: vscode.CancellationToken;
  } = {},
): Promise<void> {
  if (!(await ensureReport(state, folder, { force: opts.force, cli: opts.cli, token: opts.token }))) return;

  const location = opts.location ?? getConfig(folder.uri).reportLocation;
  if (location === "browser") {
    const uri = vscode.Uri.file(reportPath(state.context, folder));
    await vscode.env.openExternal(opts.hash ? uri.with({ fragment: opts.hash }) : uri);
  } else {
    await openReportInEditor(state, folder, opts.hash);
  }
}
