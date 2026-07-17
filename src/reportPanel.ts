import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { reportPath, projectName } from "./paths";
import { ExtensionState } from "./state";
import { openSourceAt } from "./reveal";

/** One reusable webview panel per workspace folder path. */
const panels = new Map<string, vscode.WebviewPanel>();

/**
 * Inject an initial deep-link (`<tab>~<file>`) into the report HTML so the viewer
 * opens on a specific tab / file. A classic `<head>` script runs during parse —
 * before the viewer's deferred module mounts — and sets a `window.__CLARIFYDOC_HASH__`
 * global that the viewer reads first. VS Code webviews can block fragment
 * navigation, so `location.hash` alone is unreliable here; the global always
 * survives (we still set the hash too, for good measure).
 */
function withInitialHash(html: string, hash?: string): string {
  if (!hash) return html;
  const h = JSON.stringify("#" + hash);
  const script =
    `<script>window.__CLARIFYDOC_HASH__=${h};try{location.hash=${h}}catch(e){}</script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => m + script);
  }
  return script + html;
}

/**
 * Show the interactive report for a folder in a webview editor tab, optionally
 * deep-linked to a tab/file via `hash`. The report is a fully self-contained
 * single HTML file (all CSS/JS/data inlined, no CSP meta, no external requests),
 * so we drop its contents straight into the webview with scripts enabled.
 */
export async function openReport(
  state: ExtensionState,
  folder: vscode.WorkspaceFolder,
  hash?: string,
): Promise<void> {
  const file = reportPath(state.context, folder);

  let html: string;
  try {
    html = withInitialHash(await fs.readFile(file, "utf8"), hash);
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
      // Keep the tab's state (open tab, scroll, selection) when hidden instead
      // of reloading the multi-MB payload every time it regains focus.
      retainContextWhenHidden: true,
    },
  );
  panel.iconPath = vscode.Uri.file(state.context.asAbsolutePath("media/icon.png"));
  panel.webview.html = html;

  // Two-way sync: a click on a file/symbol in the report reveals it in the editor,
  // resolved against this folder (the report's file paths are folder-relative).
  panel.webview.onDidReceiveMessage(
    (msg: { type?: string; file?: string; line?: number }) => {
      if (msg?.type !== "clarifydoc:open" || !msg.file) return;
      const abs = path.isAbsolute(msg.file) ? msg.file : path.join(folder.uri.fsPath, msg.file);
      void openSourceAt(abs, msg.line, vscode.ViewColumn.Beside);
    },
    undefined,
    state.context.subscriptions,
  );

  panels.set(key, panel);
  panel.onDidDispose(() => {
    if (panels.get(key) === panel) panels.delete(key);
  });
}

/** Refresh any open report webview whose file changed (e.g. after re-analysis). */
export async function refreshOpenReport(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
): Promise<void> {
  const panel = panels.get(folder.uri.fsPath);
  if (!panel) return;
  try {
    panel.webview.html = await fs.readFile(reportPath(context, folder), "utf8");
  } catch {
    /* report was removed; leave the last-rendered content in place */
  }
}
