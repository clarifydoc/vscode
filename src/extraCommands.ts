import * as vscode from "vscode";
import { resolveCli, runClarifyDoc, reportSpawnError } from "./cli";
import { outputBaseDir, resultsDir } from "./paths";
import { ExtensionState } from "./state";
import { lineSink } from "./lineSink";
import { pickWorkspaceFolder } from "./workspace";
import * as fs from "fs/promises";
import * as path from "path";

/** `clarifydoc detect` — quick language/framework detection, no full analysis. */
export async function detectFrameworks(
  state: ExtensionState,
  target?: vscode.WorkspaceFolder | vscode.Uri,
): Promise<void> {
  const folder = await pickWorkspaceFolder(target);
  if (!folder) return;

  const cli = await resolveCli(state.context.extensionPath);
  state.output.info(`── Detect ${folder.name} ─────────────────────────`);
  const lines = lineSink((line) => state.output.info(line));

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "ClarifyDoc: detecting frameworks…", cancellable: true },
    (_progress, token) =>
      runClarifyDoc(cli, ["detect", folder.uri.fsPath], {
        cwd: folder.uri.fsPath,
        token,
        onOutput: (c) => lines.push(c),
      })
        .finally(() => lines.end())
        .catch((err) => reportSpawnError(err, cli)),
  );

  if (!result) return;
  state.output.show(true);
  if (result.code === 0) {
    void vscode.window.showInformationMessage(
      "ClarifyDoc: detection complete — see the ClarifyDoc output.",
    );
  }
}

/**
 * `clarifydoc impact` — project the current git changes onto the last analysis
 * and render the markdown summary in a preview. Requires a prior analysis.
 */
export async function impactOfChanges(
  state: ExtensionState,
  target?: vscode.WorkspaceFolder | vscode.Uri,
): Promise<void> {
  const folder = await pickWorkspaceFolder(target);
  if (!folder) return;

  // Fail fast with a clear message if there is nothing to diff against.
  try {
    await fs.access(path.join(resultsDir(state.context, folder), "project-summary.json"));
  } catch {
    const choice = await vscode.window.showWarningMessage(
      `ClarifyDoc: analyze ${folder.name} before computing impact.`,
      "Analyze Workspace",
    );
    if (choice === "Analyze Workspace") {
      await vscode.commands.executeCommand("clarifydoc.analyze", folder);
    }
    return;
  }

  const cli = await resolveCli(state.context.extensionPath);
  const args = ["impact", folder.uri.fsPath, "-o", outputBaseDir(state.context, folder), "--md"];
  state.output.info(`── Impact ${folder.name} ─────────────────────────`);
  const lines = lineSink((line) => state.output.info(line));

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "ClarifyDoc: computing impact…", cancellable: true },
    (_progress, token) =>
      runClarifyDoc(cli, args, {
        cwd: folder.uri.fsPath,
        token,
        onOutput: (c) => lines.push(c),
      })
        .finally(() => lines.end())
        .catch((err) => reportSpawnError(err, cli)),
  );

  if (!result) return;
  if (result.code !== 0) {
    state.output.show(true);
    void vscode.window.showErrorMessage(
      "ClarifyDoc: impact analysis failed — see the ClarifyDoc output.",
    );
    return;
  }

  const md = result.stdout.trim() || "_No impact detected for the current changes._";
  const doc = await vscode.workspace.openTextDocument({
    content: `# ClarifyDoc — Impact (${folder.name})\n\n${md}\n`,
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc, { preview: true });
  await vscode.commands.executeCommand("markdown.showPreview", doc.uri);
}
