import * as vscode from "vscode";
import * as path from "path";
import { resolveCli, runClarifyDoc, reportSpawnError } from "./cli";
import { ExtensionState } from "./state";
import { openSourceAt } from "./reveal";
import { loadAnalysis, relPathOf } from "./analysisData";
import { supportsControlFlow } from "./controlFlowSupport";
import { mermaidLiveUrl } from "./mermaidLive";
import { isDarkTheme } from "./architectureDiagram";

/**
 * The control-flow view: what the complexity number on the CodeLens actually
 * means, drawn.
 *
 * The graph is built on demand by `clarifydoc cfg`, a single-file read that
 * writes nothing — a CFG is per-function detail and has no business in
 * `project-summary.json`, where it would multiply the artifact for something
 * almost nobody reads in aggregate. That also means this works on a file the
 * analyzer has never seen, and on unsaved edits, which are sent over stdin.
 *
 * The panel is bidirectional: clicking a node reveals its source, and moving
 * the cursor in the editor highlights the node covering that line. While
 * "Follow" is on (the default) it is also live: the cursor entering another
 * function re-targets it, and an edit to the function drawn redraws it from
 * the unsaved text — without taking focus from the editor, and keeping the
 * last diagram when a redraw has nothing to show.
 */

const FOLLOW = "clarifydoc.controlFlow.follow";

/** One reusable panel per workspace folder, keyed by folder path. */
const panels = new Map<string, ControlFlowPanel>();

interface CfgNode {
  id: string;
  kind: string;
  label: string;
  line: number;
  endLine: number;
  inlineBranches: number;
}

interface Cfg {
  approximate?: boolean;
  functionName: string;
  filePath: string;
  language: string;
  line: number;
  endLine: number;
  nodes: CfgNode[];
  unmodelled: string[];
  hasFinally: boolean;
}

interface CfgResponse {
  filePath: string;
  language: string;
  diagrams: { cfg: Cfg; mermaid: string; note: string }[];
}

interface Shown {
  /** Absolute path of the file the diagram was built from. */
  sourcePath: string;
  nodes: CfgNode[];
  /** The diagram as Mermaid source, and the function it draws (save names). */
  mermaid: string;
  functionName: string;
  /** The function's span, so a cursor inside it re-targets nothing. */
  line: number;
  endLine: number;
}

function nonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

class ControlFlowPanel {
  private shown: Shown | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private pending: vscode.CancellationTokenSource | undefined;
  private followTimer: NodeJS.Timeout | undefined;
  private editTimer: NodeJS.Timeout | undefined;
  /** The last place a follow found no function, so resting there does not re-run the analyzer. */
  private lastMiss: string | undefined;

  constructor(
    private readonly state: ExtensionState,
    private readonly panel: vscode.WebviewPanel,
    private readonly key: string,
    private readonly folder: vscode.WorkspaceFolder,
  ) {
    panel.webview.onDidReceiveMessage(
      (message: { type: string; line?: number; format?: string; svg?: string; on?: boolean }) => {
        if (message.type === "follow") void this.state.context.workspaceState.update(FOLLOW, message.on !== false);
        if (message.type === "save" && this.shown) {
          void this.save(message.format === "svg" ? "svg" : "mermaid", message.svg);
        }
        if (message.type === "live" && this.shown) {
          void vscode.env.openExternal(vscode.Uri.parse(mermaidLiveUrl(this.shown.mermaid, isDarkTheme())));
        }
        if (message.type === "reveal" && this.shown && typeof message.line === "number") {
          void openSourceAt(this.shown.sourcePath, message.line, vscode.ViewColumn.One);
        }
        if (message.type === "openComplexityReport" && this.shown) {
          void vscode.commands.executeCommand(
            "clarifydoc.openReportForFile",
            vscode.Uri.file(this.shown.sourcePath),
            "complexity",
          );
        }
      },
      undefined,
      this.disposables,
    );

    // Editor → diagram. Only for the file the diagram was built from, so
    // reading an unrelated file does not make the highlight wander.
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (!this.panel.visible) return;
        const line = event.selections[0]!.active.line + 1;
        if (this.shown && event.textEditor.document.uri.fsPath === this.shown.sourcePath) {
          void this.panel.webview.postMessage({ type: "cursor", line });
        }
        this.followCursor(event.textEditor.document, line);
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && this.panel.visible) this.followCursor(editor.document, editor.selection.active.line + 1);
      }),
      // Diagram ← edit: the function drawn, redrawn from what is on screen.
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!this.following() || !this.shown || event.contentChanges.length === 0) return;
        if (event.document.uri.fsPath !== this.shown.sourcePath) return;
        clearTimeout(this.editTimer);
        this.editTimer = setTimeout(() => void this.redrawAfterEdit(event.document), 700);
      }),
    );

    panel.onDidDispose(
      () => {
        clearTimeout(this.followTimer);
        clearTimeout(this.editTimer);
        this.pending?.cancel();
        this.pending?.dispose();
        panels.delete(this.key);
        for (const d of this.disposables) d.dispose();
      },
      undefined,
      this.disposables,
    );
  }

  reveal(): void {
    this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Beside);
  }

  following(): boolean {
    return this.state.context.workspaceState.get<boolean>(FOLLOW) ?? true;
  }

  /**
   * The cursor moved: when it left the function drawn for another function
   * in this folder, draw that one. Which lines are functions comes from the
   * analysis when it has the file, so a cursor between functions costs
   * nothing; a file it has not seen asks the analyzer, once per line.
   */
  private followCursor(doc: vscode.TextDocument, line: number): void {
    if (!this.following() || doc.uri.scheme !== "file") return;
    const shown = this.shown;
    if (shown && doc.uri.fsPath === shown.sourcePath && line >= shown.line && line <= shown.endLine) return;
    if (vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath !== this.key || !supportsControlFlow(doc)) return;
    clearTimeout(this.followTimer);
    this.followTimer = setTimeout(() => void this.retarget(doc, line), 300);
  }

  private async retarget(doc: vscode.TextDocument, line: number): Promise<void> {
    const at = `${doc.uri.fsPath}:${line}`;
    if (at === this.lastMiss) return;
    const rel = relPathOf(this.folder, doc.uri);
    const rows = rel ? (await loadAnalysis(this.state.context, this.folder))?.byFile.get(rel)?.complexity : undefined;
    // An edited file's rows are stale, so only a saved one may say "no function here".
    if (rows?.length && !doc.isDirty && !rows.some((r) => r.line <= line && line <= (r.endLine ?? r.line))) return;
    const drawn = await drawControlFlow(this.state, this, this.folder, doc, undefined, line, true);
    if (!drawn) this.lastMiss = at;
  }

  private async redrawAfterEdit(doc: vscode.TextDocument): Promise<void> {
    const shown = this.shown;
    if (!shown || doc.uri.fsPath !== shown.sourcePath) return;
    const editor = vscode.window.activeTextEditor;
    const cursor = editor?.document === doc ? editor.selection.active.line + 1 : undefined;
    // The cursor is in the function being edited, nearly always, and it survives a rename;
    // the name holds the function only while the cursor is elsewhere. Both at once must agree.
    await drawControlFlow(this.state, this, this.folder, doc, cursor === undefined ? shown.functionName : undefined, cursor, true);
  }

  /**
   * Save the diagram through the editor's own save dialog — a webview's blob
   * download is not something every host honours. SVG is what the panel drew;
   * Mermaid is the source, for a doc or a PR description.
   */
  private async save(format: "svg" | "mermaid", svg: string | undefined): Promise<void> {
    const shown = this.shown;
    if (!shown) return;
    const content = format === "svg" ? svg : shown.mermaid;
    if (!content) return;
    const base = shown.functionName.replace(/[^\w.-]+/g, "_") || "control-flow";
    const ext = format === "svg" ? "svg" : "mmd";
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(path.dirname(shown.sourcePath), `${base}.control-flow.${ext}`)),
      filters: format === "svg" ? { "SVG image": ["svg"] } : { Mermaid: ["mmd", "md"] },
      title: format === "svg" ? "Save control flow as SVG" : "Save control flow as Mermaid",
    });
    if (!target) return;
    const text = format === "mermaid" && target.path.endsWith(".md") ? "```mermaid\n" + content + "\n```\n" : content;
    await vscode.workspace.fs.writeFile(target, Buffer.from(text, "utf8"));
    vscode.window.setStatusBarMessage(`ClarifyDoc: saved ${path.basename(target.fsPath)}`, 3000);
  }

  /**
   * A token for the `cfg` run that will fill this panel. Asking again cancels
   * the previous run — only the newest request is ever drawn — and closing
   * the panel cancels whatever is still running.
   */
  cancellation(): vscode.CancellationToken {
    this.pending?.cancel();
    this.pending?.dispose();
    this.pending = new vscode.CancellationTokenSource();
    return this.pending.token;
  }

  /** Render a graph, replacing whatever the panel was showing; `quiet` leaves focus where it is. */
  render(sourcePath: string, entry: CfgResponse["diagrams"][number], language: string, cursor?: number, quiet = false): void {
    this.lastMiss = undefined;
    this.shown = {
      sourcePath, nodes: entry.cfg.nodes, mermaid: entry.mermaid, functionName: entry.cfg.functionName,
      line: entry.cfg.line, endLine: entry.cfg.endLine,
    };
    this.panel.title = `Control flow — ${entry.cfg.functionName}`;
    this.panel.webview.html = this.html(entry, language, cursor);
    if (!quiet) this.reveal();
  }

  /** Show a message in the panel's own surface rather than a toast. */
  renderMessage(title: string, body: string): void {
    this.shown = undefined;
    this.panel.title = title;
    this.panel.webview.html = this.messageHtml(title, body);
    this.reveal();
  }

  private uri(...parts: string[]): vscode.Uri {
    return this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.state.context.extensionUri, ...parts),
    );
  }

  private csp(n: string): string {
    // Mermaid needs no `eval`, so scripts stay nonce-locked. Styles need both
    // sources: `unsafe-inline` for the stylesheet Mermaid injects at render
    // time, and the webview origin for this panel's own `controlFlow.css` —
    // `unsafe-inline` alone silently blocks the linked sheet, since
    // `style-src` is what an unset `style-src-elem` falls back to.
    return [
      "default-src 'none'",
      `img-src ${this.panel.webview.cspSource} data:`,
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${n}'`,
      "font-src 'none'",
    ].join("; ");
  }

  private messageHtml(title: string, body: string): string {
    const n = nonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${this.csp(n)}">
<link rel="stylesheet" href="${this.uri("media", "controlFlow.css")}">
<title>${escapeHtml(title)}</title>
</head>
<body>
  <div class="cf-message">
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(body)}</p>
  </div>
</body>
</html>`;
  }

  private html(entry: CfgResponse["diagrams"][number], language: string, cursor?: number): string {
    const n = nonce();
    const { cfg, mermaid, note } = entry;
    const inline = cfg.nodes.reduce((sum, node) => sum + node.inlineBranches, 0);
    const decisions = cfg.nodes.filter((node) => node.kind === "DECISION").length;
    const loops = cfg.nodes.filter((node) => node.kind === "LOOP").length;
    const returns = cfg.nodes.filter((node) => node.kind === "RETURN").length;

    // The shape of the problem, which is the point of the whole view: "6 loops,
    // 11 early returns" is actionable in a way that "complexity 47" is not.
    const shape = [
      `${decisions} ${plural(decisions, "decision")}`,
      `${loops} ${plural(loops, "loop")}`,
      `${returns} ${plural(returns, "exit point")}`,
      inline > 0 ? `${inline} hidden in expressions` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const payload = JSON.stringify({
      diagram: mermaid,
      cursor: cursor ?? null,
      nodes: cfg.nodes.map((node) => ({
        id: node.id,
        line: node.line,
        endLine: node.endLine,
      })),
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${this.csp(n)}">
<link rel="stylesheet" href="${this.uri("media", "controlFlow.css")}">
<title>Control flow</title>
</head>
<body>
  <header class="cf-header">
    <h1>${escapeHtml(cfg.functionName)}</h1>
    <p class="cf-meta">${escapeHtml(cfg.filePath)}:${cfg.line}–${cfg.endLine} · ${escapeHtml(language)}</p>
    <p class="cf-shape">${escapeHtml(shape)}</p>
    ${cfg.approximate ? `<p class="cf-approx">Approximate — ${escapeHtml(language)} has no parser here, so this was read off the source text.</p>` : ""}
    ${note ? `<p class="cf-note">${escapeHtml(note)}.</p>` : ""}
    <p class="cf-hint">Click a node to jump to it. Move the cursor in the editor to highlight the node it is in.</p>
    <label class="cf-follow"><input type="checkbox" id="cf-follow"${this.following() ? " checked" : ""}> Follow the cursor and redraw on edit</label>
    <button type="button" id="cf-report" class="cf-link">Open the Complexity report for this file</button>
    <button type="button" id="cf-save-svg" class="cf-link">Save as SVG</button>
    <button type="button" id="cf-save-mermaid" class="cf-link">Save as Mermaid</button>
    <button type="button" id="cf-live" class="cf-link" title="Opens mermaid.live in your browser, with this diagram in the link">Open in Mermaid Live</button>
  </header>
  <div id="cf-graph" class="cf-graph"></div>
  <script nonce="${n}" type="application/json" id="cf-payload">${escapeJson(payload)}</script>
  <script nonce="${n}" src="${this.uri("media", "vendor", "mermaid.min.js")}"></script>
  <script nonce="${n}" src="${this.uri("media", "controlFlow.js")}"></script>
</body>
</html>`;
  }
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * JSON inside a `<script>` element. The parser looks for `</script` before any
 * JSON rules apply, so a string containing one would end the block early and
 * spill the rest of the payload into the document as markup — and the payload
 * here is arbitrary source text.
 */
function escapeJson(value: string): string {
  return value.replace(/</g, "\\u003c");
}

function panelFor(state: ExtensionState, folder: vscode.WorkspaceFolder): ControlFlowPanel {
  const key = folder.uri.fsPath;
  const existing = panels.get(key);
  if (existing) return existing;

  const panel = vscode.window.createWebviewPanel(
    "clarifydoc.controlFlow",
    "Control flow",
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(state.context.extensionUri, "media")],
    },
  );
  const wrapper = new ControlFlowPanel(state, panel, key, folder);
  panels.set(key, wrapper);
  return wrapper;
}

/**
 * Draw the control flow of one function. `functionName` and `line` are both
 * optional selectors; the CLI resolves them against the same complexity rows
 * the CodeLens was built from, and prefers the line when they disagree.
 */
export async function showControlFlow(
  state: ExtensionState,
  target?: vscode.Uri | string,
  functionName?: string,
  line?: number,
): Promise<void> {
  const uri = typeof target === "string" ? vscode.Uri.parse(target) : target;
  const editor = vscode.window.activeTextEditor;
  const doc = uri
    ? await vscode.workspace.openTextDocument(uri).then(
        (d) => d,
        () => undefined,
      )
    : editor?.document;
  if (!doc) {
    void vscode.window.showWarningMessage("ClarifyDoc: open a source file first.");
    return;
  }

  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (!folder) {
    void vscode.window.showWarningMessage("ClarifyDoc: control flow needs a file inside a workspace folder.");
    return;
  }
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage(
      "ClarifyDoc needs a trusted workspace to run the analyzer.",
    );
    return;
  }

  // Fall back to the cursor when no line was passed, so the palette command
  // works with no arguments at all.
  const selectedLine =
    line ??
    (editor && editor.document.uri.fsPath === doc.uri.fsPath
      ? editor.selection.active.line + 1
      : undefined);

  await drawControlFlow(state, panelFor(state, folder), folder, doc, functionName, selectedLine, false);
}

/**
 * Run `clarifydoc cfg` for one function and draw it. Quiet (a follow or an
 * edit): no progress, no focus change, and a run with nothing to draw leaves
 * the last diagram up. Resolves whether a diagram was drawn.
 */
async function drawControlFlow(
  state: ExtensionState,
  view: ControlFlowPanel,
  folder: vscode.WorkspaceFolder,
  doc: vscode.TextDocument,
  functionName: string | undefined,
  selectedLine: number | undefined,
  quiet: boolean,
): Promise<boolean> {
  const args = ["cfg", doc.uri.fsPath, "--format", "json", "--no-styled"];
  if (functionName) args.push("--function", functionName);
  if (selectedLine !== undefined) args.push("--line", String(selectedLine));
  // Unsaved edits: draw what is on screen, not what is on disk.
  const stdin = doc.isDirty ? doc.getText() : undefined;
  if (stdin !== undefined) args.push("--stdin");

  const cli = await resolveCli(state.context.extensionPath);

  let result;
  try {
    const token = view.cancellation();
    const spawn = (withStdin: boolean) =>
      runClarifyDoc(cli, withStdin ? args : args.filter((a) => a !== "--stdin"), {
        cwd: folder.uri.fsPath,
        token,
        stdin: withStdin ? stdin : undefined,
      });
    const run = (withStdin: boolean) =>
      quiet
        ? spawn(withStdin)
        : vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "ClarifyDoc: building control flow…" }, () => spawn(withStdin));
    result = await run(stdin !== undefined);
    // An analyzer set through clarifydoc.cliPath may predate --stdin: draw the saved file instead.
    if (stdin !== undefined && result.code !== 0 && /unknown option '--stdin'/.test(result.stderr)) result = await run(false);
    // A newer request took over this panel; what this run found is no longer wanted.
    if (token.isCancellationRequested) return false;
  } catch (error) {
    if (!quiet) reportSpawnError(error, cli);
    return false;
  }

  if (quiet && result.code !== 0) return false;
  if (result.code !== 0) {
    // The CLI prints the file's functions on stderr when nothing matched;
    // that listing is more use to the reader than "command failed".
    view.renderMessage(
      "No control flow to show",
      result.stderr.trim() || `clarifydoc cfg exited with code ${result.code}.`,
    );
    return false;
  }

  let parsed: CfgResponse;
  try {
    parsed = JSON.parse(result.stdout) as CfgResponse;
  } catch {
    state.output.error(`[cfg] could not parse cfg output:\n${result.stdout.slice(0, 500)}`);
    if (!quiet) view.renderMessage("Control flow unavailable", "The analyzer returned output this view could not read; see the ClarifyDoc output channel.");
    return false;
  }

  const entry = parsed.diagrams[0];
  if (!entry) {
    if (!quiet) view.renderMessage("No control flow to show", `Nothing in ${path.basename(doc.uri.fsPath)} has a body to draw.`);
    return false;
  }

  view.render(doc.uri.fsPath, entry, parsed.language, selectedLine, quiet);
  return true;
}
