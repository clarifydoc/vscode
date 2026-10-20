import * as vscode from "vscode";
import { randomBytes } from "crypto";
import * as path from "path";
import { loadAnalysis, loadFileIndex, relPathOf } from "./analysisData";
import { filesGraph, nodeAtLine, type GraphView } from "./filesGraph";
import { openSourceAt } from "./reveal";
import { ExtensionState } from "./state";

/**
 * The docked graph (VSCODE 2.2): a view in the ClarifyDoc sidebar showing the
 * active editor's file — its functions, the calls between them, what calls in
 * and what they call out to, the routes it serves and the HTTP calls it makes —
 * redrawn when another file comes forward or the analysis changes, with the
 * function under the cursor outlined as the cursor moves. A node opens its
 * source. Two views of the same facts: functions, or files only.
 */
export class NeighbourhoodView implements vscode.WebviewViewProvider {
  static readonly id = "clarifydoc.neighbourhood";
  private view?: vscode.WebviewView;
  private shown: { folder: vscode.WorkspaceFolder; rel: string; views: GraphView[] } | null = null;
  private current = 0;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly state: ExtensionState) {
    state.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(NeighbourhoodView.id, this, { webviewOptions: { retainContextWhenHidden: true } }),
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule()),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor === vscode.window.activeTextEditor) this.focusCursor();
      }),
      // A new analysis redraws even the same file.
      state.onAnalysisChanged(() => {
        this.shown = null;
        this.schedule();
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.state.context.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const uri = (...p: string[]) => view.webview.asWebviewUri(vscode.Uri.joinPath(media, ...p));
    const nonce = randomBytes(16).toString("base64");
    const csp = `default-src 'none'; img-src ${view.webview.cspSource} data:; style-src ${view.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    view.webview.html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${uri("controlFlow.css")}"><title>Neighbourhood</title>
<style>body{padding:4px 6px}.nb-head{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px;margin-bottom:4px}.nb-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.nb-graph svg{max-width:100%;height:auto}.nb-focus rect,.nb-focus polygon,.nb-focus path{stroke:var(--vscode-focusBorder)!important;stroke-width:3px!important}.nb-note{opacity:.75;font-size:11px}</style></head>
<body>
  <div class="nb-head"><span class="nb-title" id="nb-title">Open a file</span><span id="nb-views"></span></div>
  <div class="nb-note" id="nb-note">The open file's functions, its calls in and out, and the routes it serves or calls.</div>
  <div id="nb-graph" class="nb-graph"></div>
  <script nonce="${nonce}" src="${uri("vendor", "mermaid.min.js")}"></script>
  <script nonce="${nonce}" src="${uri("neighbourhood.js")}"></script>
</body></html>`;
    view.webview.onDidReceiveMessage((m: { type: string; node?: string; view?: number }) => {
      if (typeof m.view === "number") this.current = m.view;
      if (m.type === "ready") void this.refresh();
      if (m.type === "open" && m.node && this.shown) {
        const at = this.shown.views[this.current]?.nodes[m.node];
        if (at) void openSourceAt(path.join(this.shown.folder.uri.fsPath, at.file), at.line, vscode.ViewColumn.One);
      }
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) this.schedule();
    });
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 250);
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private async refresh(): Promise<void> {
    if (!this.view?.visible) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") return;
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    const rel = folder ? relPathOf(folder, editor.document.uri) : undefined;
    if (!folder || rel === undefined) return;
    if (this.shown && this.shown.folder === folder && this.shown.rel === rel) return this.focusCursor();
    const analysis = await loadAnalysis(this.state.context, folder);
    const facts = analysis?.byFile.get(rel);
    if (!analysis || !facts) {
      this.shown = null;
      this.post({ type: "empty", title: rel.split("/").pop(), note: analysis ? "Not in the analysis: excluded, or added since it ran." : "No analysis yet — run ClarifyDoc: Analyze Workspace." });
      return;
    }
    const idx = await loadFileIndex(this.state.context, folder, rel, facts);
    const g = filesGraph([{ file: rel, defs: idx.defs, outbound: facts.outbound, inbound: facts.inbound, callsRoutes: facts.callsRoutes, servesCalls: facts.servesCalls, routes: facts.routes }], { maxPerFile: 25, maxOutside: 10 });
    this.shown = { folder, rel, views: [g.functions, g.files] };
    this.post({
      type: "show",
      title: rel,
      note: g.summary,
      current: this.current,
      views: this.shown.views.map((v) => ({ label: v.label, diagram: v.mermaid, nodes: Object.keys(v.nodes) })),
    });
    this.focusCursor();
  }

  private focusCursor(): void {
    const editor = vscode.window.activeTextEditor;
    if (!this.shown || !editor) return;
    const node = nodeAtLine(this.shown.views[this.current]!, this.shown.rel, editor.selection.active.line + 1);
    this.post({ type: "focus", node });
  }
}
