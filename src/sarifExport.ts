import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { ExtensionState } from "./state";
import { loadAnalysis, loadAnalyzer } from "./analysisData";
import { resultsDir } from "./paths";
import { pickWorkspaceFolder } from "./workspace";

const SARIF_VIEWER = "MS-SarifVSCode.sarif-viewer";

/**
 * Write the latest analysis's security findings as SARIF 2.1.0 — what GitHub
 * code scanning and SARIF viewers read — from the analysis already on disk,
 * without analyzing again. The log names files relative to `%SRCROOT%`, which
 * is set to the workspace folder so a viewer resolves them without asking.
 */
export async function exportSarif(state: ExtensionState, target?: vscode.WorkspaceFolder | vscode.Uri): Promise<void> {
  const folder = await pickWorkspaceFolder(target);
  if (!folder) return;
  const analysis = await loadAnalysis(state.context, folder);
  const analyzer = await loadAnalyzer(state.context);
  if (!analysis) {
    const choice = await vscode.window.showWarningMessage(`ClarifyDoc: analyze ${folder.name} first.`, "Analyze Workspace");
    if (choice === "Analyze Workspace") await vscode.commands.executeCommand("clarifydoc.analyze", folder);
    return;
  }
  if (!analyzer?.buildSarif) {
    void vscode.window.showErrorMessage("ClarifyDoc: the bundled analyzer cannot write SARIF. Update the extension.");
    return;
  }

  const log = analyzer.buildSarif(analysis.security, analyzer.TOOL_VERSION ?? "unknown");
  for (const run of log.runs) {
    run.originalUriBaseIds = { "%SRCROOT%": { uri: `${folder.uri.toString().replace(/\/?$/, "/")}` } };
  }
  const file = path.join(resultsDir(state.context, folder), "clarifydoc.sarif");
  await fs.writeFile(file, JSON.stringify(log, null, 2));
  state.output.info(`[sarif] ${analysis.security.length} finding(s) → ${file}`);

  const uri = vscode.Uri.file(file);
  if (vscode.extensions.getExtension(SARIF_VIEWER)) {
    await vscode.commands.executeCommand("vscode.open", uri);
    return;
  }
  await vscode.window.showTextDocument(uri, { preview: true });
  void vscode.window
    .showInformationMessage(
      `ClarifyDoc: wrote ${analysis.security.length} finding(s) as SARIF. The SARIF Viewer extension lets you browse them.`,
      "Find SARIF Viewer",
    )
    .then((choice) => {
      if (choice === "Find SARIF Viewer") void vscode.commands.executeCommand("workbench.extensions.search", SARIF_VIEWER);
    });
}
