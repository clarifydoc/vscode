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
/** Where each panel's viewer is (its deep link), re-applied when it reloads. */
const lastHash = new Map<string, string | undefined>();

const VIEW_TYPE = "clarifydoc.report";

const panelOptions: vscode.WebviewPanelOptions & vscode.WebviewOptions = {
  enableScripts: true,
  // Everything the report needs is inline; it may load nothing from disk.
  localResourceRoots: [],
  // Keep the tab's state (open tab, scroll, selection) when hidden instead
  // of reloading the multi-MB payload every time it regains focus.
  retainContextWhenHidden: true,
};

/** The report page for a folder, ready for the webview. */
async function reportHtml(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder, hash?: string): Promise<string> {
  const raw = await fs.readFile(reportPath(context, folder), "utf8");
  // The viewer keeps this in its webview state, so a reload knows the folder.
  return prepareReportHtml(raw, hash, { folder: folder.uri.toString() });
}

/**
 * Make a panel this folder's report view: content, title, the two-way bridge,
 * and bookkeeping. Used for a new panel and for one VS Code restores after a
 * window reload.
 */
function adopt(state: ExtensionState, folder: vscode.WorkspaceFolder, panel: vscode.WebviewPanel, html: string, hash?: string): void {
  const key = folder.uri.fsPath;
  panel.title = `ClarifyDoc — ${projectName(folder)}`;
  panel.iconPath = vscode.Uri.file(state.context.asAbsolutePath("media/icon.png"));
  panel.webview.options = panelOptions;
  panel.webview.html = html;
  lastHash.set(key, hash);

  // Two-way sync: a click on a file/symbol in the report reveals it in the editor,
  // resolved against this folder (the report's file paths are folder-relative).
  // The page is built from the analyzed repository's contents, so a path it
  // sends is opened only when it stays inside the folder.
  const onMessage = panel.webview.onDidReceiveMessage((msg: { type?: string; file?: unknown; line?: unknown; hash?: unknown }) => {
    if (msg?.type === "clarifydoc:hash" && typeof msg.hash === "string") {
      if (panels.get(key) === panel) lastHash.set(key, msg.hash || undefined);
      return;
    }
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
  let html: string;
  try {
    html = await reportHtml(state.context, folder, hash);
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
    lastHash.set(key, hash);
    existing.webview.html = html;
    existing.reveal(existing.viewColumn ?? vscode.ViewColumn.Active);
    return;
  }
  const panel = vscode.window.createWebviewPanel(VIEW_TYPE, `ClarifyDoc — ${projectName(folder)}`, vscode.ViewColumn.Active, panelOptions);
  adopt(state, folder, panel, html, hash);
}

/**
 * Bring report panels back after a window reload, at the deep link the viewer
 * last remembered. A panel whose folder left the workspace, or whose report is
 * gone, is closed rather than left blank.
 */
export function registerReportSerializer(state: ExtensionState): void {
  state.context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, saved: unknown) {
        const s = (saved ?? {}) as { folder?: unknown; hash?: unknown };
        const folder =
          typeof s.folder === "string"
            ? vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(s.folder))
            : (vscode.workspace.workspaceFolders ?? [])[0];
        const hash = typeof s.hash === "string" && s.hash ? s.hash : undefined;
        if (!folder || panels.has(folder.uri.fsPath)) {
          panel.dispose();
          return;
        }
        try {
          adopt(state, folder, panel, await reportHtml(state.context, folder, hash), hash);
        } catch {
          panel.dispose();
        }
      },
    }),
  );
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
    // Reloading would drop where the reader was; re-apply it.
    panel.webview.html = await reportHtml(context, folder, lastHash.get(key));
  } catch {
    /* report was removed; leave the last-rendered content in place */
  }
}
