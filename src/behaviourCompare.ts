import * as vscode from "vscode";
import * as path from "path";
import { resolveCli, runClarifyDoc } from "./cli";
import { resultsDir } from "./paths";
import { baseAnalysisDir } from "./surfaceCompare";
import { loadAnalysis } from "./analysisData";
import { behaviourCandidates, parseSeqDiff, type BehaviourRow, type SurfaceDiff } from "./surfaceModel";

/**
 * "Behaviour changed" rows of Compare API Surface: for the few routes that
 * qualify (see `behaviourCandidates`), `clarifydoc seq --route <r> --diff
 * <base analysis>` says whether the route's flow differs from the base's; the
 * row opens that diff as text.
 */

function seqArgs(folder: vscode.WorkspaceFolder, context: vscode.ExtensionContext, commit: string, route: string, file?: string): string[] {
  return ["seq", folder.uri.fsPath, "--route", route, "--analysis-dir", resultsDir(context, folder), "--diff", baseAnalysisDir(context, folder, commit), ...(file ? ["--file", file] : [])];
}

/** The routes whose flow changed against the base. Never throws: a row that cannot be judged is left out. */
export async function behaviourRows(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
  commit: string,
  diff: SurfaceDiff,
  changedFiles: readonly string[],
): Promise<BehaviourRow[]> {
  try {
    const analysis = await loadAnalysis(context, folder);
    const headRoutes = (analysis?.routes ?? [])
      .filter((r) => r.httpMethod && r.kind !== "frontend")
      .map((r) => ({ route: `${r.httpMethod} ${r.path}`, file: r.filePath }));
    const cli = await resolveCli(context.extensionPath);
    const rows: BehaviourRow[] = [];
    for (const c of behaviourCandidates(diff, changedFiles, headRoutes)) {
      const res = await runClarifyDoc(cli, seqArgs(folder, context, commit, c.route, c.file), { cwd: folder.uri.fsPath });
      const steps = res.code === 0 ? parseSeqDiff(res.stdout) : null;
      if (steps) rows.push({ route: c.route, ...(c.file ? { file: c.file } : {}), steps });
    }
    return rows;
  } catch {
    return [];
  }
}

/** Open the sequence diff of one route against the compared base. */
export async function showSequenceDiff(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
  commit: string,
  baseLabel: string,
  route: string,
  file?: string,
): Promise<void> {
  const cli = await resolveCli(context.extensionPath);
  const res = await runClarifyDoc(cli, seqArgs(folder, context, commit, route, file), { cwd: folder.uri.fsPath });
  if (res.code !== 0 || !res.stdout.trim()) {
    void vscode.window.showErrorMessage(`ClarifyDoc: no sequence diff for ${route}: ${res.stderr.trim().split("\n").pop() || "no output"}`);
    return;
  }
  const header = `Sequence of ${route}${file ? ` (${path.basename(file)})` : ""}, compared with ${baseLabel}\n(+ now, - was, ~ moved; read from the analysis, not from running the code)\n\n`;
  const doc = await vscode.workspace.openTextDocument({ content: header + res.stdout, language: "plaintext" });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}
