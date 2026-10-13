import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { reportPath, projectName } from "./paths";
import { ExtensionState } from "./state";
import { openSourceAt } from "./reveal";
import { relativeInside } from "./pathUtil";
import { prepareReportHtml } from "./reportHtml";

/** One reusable webview panel per workspace folder path. */
const panels = new Map<string, vscode.WebviewPanel>();
/** The deep link each panel was last opened at, re-applied when it reloads. */
const lastHash = new Map<string, string | undefined>();

/**
 * Show the interactive report for a folder in a webview editor tab, optionally
 * deep-linked to a tab/file via `hash`. The report is a fully self-contained
 * single HTML file (all CSS/JS/data inlined, no external requests); it is shown
 * under a CSP that allows exactly that (`REPORT_CSP`) and no local resources.
 */
export async function openReport(
  state: ExtensionState,
  folder: vscode.WorkspaceFolder,
  hash?: string,
): Promise<void> {
  const file = reportPath(state.context, folder);

  let html: string;
  try {
    html = prepareReportHtml(await fs.readFile(file, "utf8"), hash);
  } catch {
    const choice = await vscode.window.showWarningMessage(
      `ClarifyDoc: no report found for ${folder.name}. Analyze it first.`,
      "Analyze Workspace",
    );
    if (choice === "Analyze Workspace") {
      await vscode.commands.executeCommand("clarifydoc.analyze", folder);
    }
    return;
  }

  const key = folder.uri.fsPath;
  lastHash.set(key, hash);
  const existing = panels.get(key);
  if (existing) {
    // Reassigning html reloads the webview, so the injected hash re-seeds the
    // viewer's initial tab/file even when the panel was already open.
    existing.webview.html = html;
    existing.reveal(existing.viewColumn ?? vscode.ViewColumn.Active);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "clarifydoc.report",
    `ClarifyDoc — ${projectName(folder)}`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      // Everything the report needs is inline; it may load nothing from disk.
      localResourceRoots: [],
      // Keep the tab's state (open tab, scroll, selection) when hidden instead
      // of reloading the multi-MB payload every time it regains focus.
      retainContextWhenHidden: true,
    },
  );
  panel.iconPath = vscode.Uri.file(state.context.asAbsolutePath("media/icon.png"));
  panel.webview.html = html;

  // Two-way sync: a click on a file/symbol in the report reveals it in the editor,
  // resolved against this folder (the report's file paths are folder-relative).
  // The page is built from the analyzed repository's contents, so a path it
  // sends is opened only when it stays inside the folder.
  const onMessage = panel.webview.onDidReceiveMessage((msg: { type?: string; file?: unknown; line?: unknown }) => {
    if (msg?.type !== "clarifydoc:open" || typeof msg.file !== "string") return;
    const rel = relativeInside(folder.uri.fsPath, msg.file);
    if (!rel) {
      state.output.warn(`[report] refused to open ${msg.file}: outside ${folder.uri.fsPath}`);
      return;
    }
    const line = typeof msg.line === "number" ? msg.line : undefined;
    void openSourceAt(path.join(folder.uri.fsPath, rel), line, vscode.ViewColumn.Beside);
  });

  panels.set(key, panel);
  panel.onDidDispose(() => {
    onMessage.dispose();
    if (panels.get(key) === panel) {
      panels.delete(key);
      lastHash.delete(key);
    }
  });
}

/** Whether a report panel is open for the folder. */
export function hasOpenReport(folder: vscode.WorkspaceFolder): boolean {
  return panels.has(folder.uri.fsPath);
}

/** Refresh any open report webview whose file changed (e.g. after re-analysis). */
export async function refreshOpenReport(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
): Promise<void> {
  const key = folder.uri.fsPath;
  const panel = panels.get(key);
  if (!panel) return;
  try {
    // Reloading would drop the deep link the panel was opened at; re-apply it.
    panel.webview.html = prepareReportHtml(await fs.readFile(reportPath(context, folder), "utf8"), lastHash.get(key));
  } catch {
    /* report was removed; leave the last-rendered content in place */
  }
}
