import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { reportPath, projectName, resultsDir } from "./paths";
import { ExtensionState } from "./state";
import { openSourceAt } from "./reveal";
import { relativeInside } from "./pathUtil";
import { prepareReportHtml } from "./reportHtml";
import { getConfig } from "./config";
import { loadAnalysis } from "./analysisData";
import { answerReportRequest } from "./notesHost";

/** One reusable webview panel per workspace folder path. */
const panels = new Map<string, vscode.WebviewPanel>();
/** Where each panel's viewer is (its deep link), re-applied when it reloads. */
const lastHash = new Map<string, string | undefined>();
/**
 * Panels whose viewer said it is up (`clarifydoc:ready`): those are navigated
 * and reloaded by message, in place. Any other — an older viewer, one still
 * inflating its payload — gets its page replaced, as before.
 */
const ready = new WeakSet<vscode.WebviewPanel>();
/** For tests: where each panel's viewer says it is, and how often its page was replaced. */
const viewerHash = new WeakMap<vscode.WebviewPanel, string>();
const pageLoads = new WeakMap<vscode.WebviewPanel, number>();

/** Replace a panel's page; it is not ready again until its new viewer says so. */
function setHtml(panel: vscode.WebviewPanel, html: string): void {
  ready.delete(panel);
  pageLoads.set(panel, (pageLoads.get(panel) ?? 0) + 1);
  panel.webview.html = html;
}

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
  const impact = await readLatestImpact(context, folder);
  // The viewer keeps this in its webview state, so a reload knows the folder.
  return prepareReportHtml(raw, hash, { folder: folder.uri.toString() }, impact ?? undefined);
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
  setHtml(panel, html);
  lastHash.set(key, hash);

  // Two-way sync: a click on a file/symbol in the report reveals it in the editor,
  // resolved against this folder (the report's file paths are folder-relative).
  // The page is built from the analyzed repository's contents, so a path it
  // sends is opened only when it stays inside the folder.
  const onMessage = panel.webview.onDidReceiveMessage((msg: { type?: string; file?: unknown; line?: unknown; hash?: unknown; filename?: unknown; base64?: unknown; req?: unknown; op?: unknown }) => {
    if (msg?.type === "clarifydoc:request" && typeof msg.req === "number") {
      const req = msg.req;
      void answerReportRequest(state, folder, msg)
        .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
        .then((answer) => panel.webview.postMessage({ type: "clarifydoc:reply", req, ...answer }));
      return;
    }
    if (msg?.type === "clarifydoc:save") {
      void saveFromReport(folder, msg.filename, msg.base64);
      return;
    }
    if (msg?.type === "clarifydoc:ready") {
      ready.add(panel);
      return;
    }
    if (msg?.type === "clarifydoc:hash" && typeof msg.hash === "string") {
      viewerHash.set(panel, msg.hash);
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
  const key = folder.uri.fsPath;
  const open = panels.get(key);
  // The report is already up in a viewer that can move: send it there, no reload.
  if (open && ready.has(open)) {
    if (hash) {
      lastHash.set(key, hash);
      void open.webview.postMessage({ type: "clarifydoc:navigate", hash });
    }
    open.reveal(open.viewColumn ?? vscode.ViewColumn.Active);
    return;
  }
  let html: string;
  try {
    html = await reportHtml(state.context, folder, hash);
  } catch {
    const choice = await vscode.window.showWarningMessage(
      `ClarifyDoc: no report found for ${folder.name}. Analyze it first.`,
      "Analyze Workspace",
    );
    if (choice !== "Analyze Workspace") return;
    await vscode.commands.executeCommand("clarifydoc.analyze", folder);
    // The analysis may have opened the report at its default tab; the place asked for is still owed.
    try {
      html = await reportHtml(state.context, folder, hash);
    } catch {
      return; // the analysis failed, and said so
    }
  }

  const existing = panels.get(key);
  if (existing) {
    // Reassigning html reloads the webview, so the injected hash re-seeds the
    // viewer's initial tab/file even when the panel was already open.
    lastHash.set(key, hash);
    setHtml(existing, html);
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

/** The report in front — the active panel, else the only one — and where its viewer is. */
export function currentReportView(): { folderPath: string; hash?: string } | undefined {
  const open = [...panels];
  const pick = open.find(([, p]) => p.active) ?? (open.length === 1 ? open[0] : undefined);
  return pick ? { folderPath: pick[0], hash: lastHash.get(pick[0]) } : undefined;
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
    if (ready.has(panel)) {
      // In place: the new analysis's payload, to a viewer that keeps the panel and remounts where the reader is.
      const raw = await fs.readFile(reportPath(context, folder), "utf8");
      const data = embeddedPayload(raw);
      if (data) {
        const impact = await readLatestImpact(context, folder);
        void panel.webview.postMessage({ type: "clarifydoc:reload", ...data, impact: impact ?? undefined, hash: lastHash.get(key) });
        return;
      }
    }
    // Reloading would drop where the reader was; re-apply it.
    setHtml(panel, await reportHtml(context, folder, lastHash.get(key)));
  } catch {
    /* report was removed; leave the last-rendered content in place */
  }
}

/** What a report may hand over to be saved: its graphs, as images. */
const SAVABLE = /\.(svg|png)$/i;
const MAX_SAVE_BYTES = 64 * 1024 * 1024;

/**
 * A graph the report's viewer exported, written where the user picks through
 * the editor's save dialog (a webview cannot download). The page is built from
 * the analyzed repository, so its name is reduced to a plain file name and
 * only an image type is accepted.
 */
async function saveFromReport(folder: vscode.WorkspaceFolder, filename: unknown, base64: unknown): Promise<void> {
  if (typeof filename !== "string" || typeof base64 !== "string") return;
  const name = path.basename(filename).replace(/[^\w.-]+/g, "_");
  if (!SAVABLE.test(name) || base64.length > (MAX_SAVE_BYTES * 4) / 3) return;
  const ext = path.extname(name).slice(1).toLowerCase();
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(folder.uri, name),
    filters: ext === "svg" ? { "SVG image": ["svg"] } : { "PNG image": ["png"] },
    title: "Save the graph",
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(base64, "base64"));
  vscode.window.setStatusBarMessage(`ClarifyDoc: saved ${path.basename(target.fsPath)}`, 3000);
}

/** The report tabs that focus one file, and so can follow the editor. */
const FOLLOWING_TABS = /^(ui|traces|blast)(?=~|$)/;

/** The deep link that follows `rel` from where a viewer is, or undefined when its tab does not focus a file. */
export function followHash(current: string | undefined, rel: string): string | undefined {
  const tab = FOLLOWING_TABS.exec(current ?? "")?.[1];
  if (!tab) return undefined;
  const next = `${tab}~${encodeURIComponent(rel)}`;
  return next === current ? undefined : next;
}

/**
 * VSCODE-PLAN 2.2, `clarifydoc.report.followEditor` (off by default): with a
 * report open on a tab that focuses one file — traces, screens, blast radius
 * — switching editors moves it to the new file, by message, debounced. Only a
 * viewer that can move in place is followed; nothing is ever reloaded for it.
 */
export function registerFollowEditor(state: ExtensionState): void {
  let timer: NodeJS.Timeout | undefined;
  state.context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      clearTimeout(timer);
      if (!editor || editor.document.uri.scheme !== "file") return;
      const uri = editor.document.uri;
      timer = setTimeout(() => void follow(uri), 400);
    }),
    { dispose: () => clearTimeout(timer) },
    vscode.commands.registerCommand("clarifydoc.internal.reportState", (folder: vscode.WorkspaceFolder) => {
      const panel = panels.get(folder.uri.fsPath);
      return panel ? { ready: ready.has(panel), viewerHash: viewerHash.get(panel), pageLoads: pageLoads.get(panel) ?? 0 } : null;
    }),
  );
  async function follow(uri: vscode.Uri): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder || !getConfig(folder.uri).reportFollowEditor) return;
    const key = folder.uri.fsPath;
    const panel = panels.get(key);
    if (!panel || !ready.has(panel)) return;
    const rel = relativeInside(folder.uri.fsPath, uri.fsPath);
    if (!rel) return;
    const hash = followHash(lastHash.get(key), rel);
    // A file the analysis never read would land on the tab's first entry: stay where the reader is.
    if (!hash || !(await loadAnalysis(state.context, folder))?.files.has(rel)) return;
    lastHash.set(key, hash);
    void panel.webview.postMessage({ type: "clarifydoc:navigate", hash });
  }
}

/**
 * The payload a report page embeds (`#clarifydoc-data`): gzip+base64, or plain
 * JSON from an older generator. Undefined when the page has none.
 */
export function embeddedPayload(html: string): { data: string; json: boolean } | undefined {
  const m = /<script\b([^>]*\bid=["']clarifydoc-data["'][^>]*)>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return undefined;
  const data = m[2]!.trim();
  if (!data || data.startsWith("__CLARIFYDOC")) return undefined;
  return { data, json: /\btype=["']application\/json["']/i.test(m[1]!) };
}

/**
 * What the last incremental run changed and reached (`impact-latest.json`,
 * written beside the summary on every `--incremental` run). Null when there
 * is none, or it is from before the summary it sits beside.
 */
export async function readLatestImpact(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): Promise<{ changedFiles: string[]; routeCount: number; screenCount: number } | null> {
  try {
    const text = await fs.readFile(path.join(resultsDir(context, folder), "impact-latest.json"), "utf8");
    const impact = JSON.parse(text) as { changedFiles?: unknown; routeCount?: number; screenCount?: number };
    return Array.isArray(impact.changedFiles) ? (impact as { changedFiles: string[]; routeCount: number; screenCount: number }) : null;
  } catch {
    return null;
  }
}
