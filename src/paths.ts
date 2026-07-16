import * as path from "path";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as vscode from "vscode";

/**
 * Isolated output layout. All analysis artifacts live under the extension's
 * private global-storage directory — never inside the user's workspace — so a
 * scan leaves the project tree completely untouched:
 *
 *   <globalStorage>/analyses/<folder-key>/<project-name>/{project-summary.json, report.html, …}
 *
 * The CLI derives <project-name> as the basename of the analyzed path and writes
 * to `<output>/<project-name>/`, so we pass `<globalStorage>/analyses/<folder-key>`
 * as its `-o` and it lands where we expect. <folder-key> mixes the basename with
 * a hash of the absolute path so two folders that share a name never collide.
 */
export function projectName(folder: vscode.WorkspaceFolder): string {
  return path.basename(folder.uri.fsPath);
}

export function folderKey(folder: vscode.WorkspaceFolder): string {
  const hash = crypto.createHash("sha1").update(folder.uri.fsPath).digest("hex").slice(0, 8);
  const base = projectName(folder).replace(/[^\w.-]+/g, "_") || "workspace";
  return `${base}-${hash}`;
}

export function analysesRoot(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "analyses");
}

/** Absolute base output directory passed to the CLI via `-o`. */
export function outputBaseDir(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): string {
  return path.join(analysesRoot(context), folderKey(folder));
}

/** Absolute directory that holds project-summary.json / report.html. */
export function resultsDir(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): string {
  return path.join(outputBaseDir(context, folder), projectName(folder));
}

export function summaryPath(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): string {
  return path.join(resultsDir(context, folder), "project-summary.json");
}

export function reportPath(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): string {
  return path.join(resultsDir(context, folder), "report.html");
}

/** Ensure the per-folder output base exists before the CLI writes into it. */
export async function ensureOutputDir(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
): Promise<string> {
  const dir = outputBaseDir(context, folder);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
