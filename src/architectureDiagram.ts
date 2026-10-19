import * as vscode from "vscode";
import { randomBytes } from "crypto";
import { ExtensionState } from "./state";
import { pickWorkspaceFolder } from "./workspace";
import { resolveCli, runClarifyDoc } from "./cli";
import { resultsDir, summaryPath } from "./paths";
import { existsSync } from "fs";
import * as path from "path";
import { loadAnalysis } from "./analysisData";
import { openSourceAt } from "./reveal";
import type { GraphView } from "./filesGraph";

/** The diagrams and documents `clarifydoc export` renders, as the picker offers them. */
const CHOICES = [
  { label: "$(type-hierarchy) Sub-projects and how they call each other", format: "context.mmd" },
  { label: "$(database) Data model (entities and relations)", format: "er.mmd" },
  { label: "$(arrow-swap) Flows: caller → API route → table or queue", format: "flows.mmd" },
  { label: "$(server-environment) Deployment: services and their edges", format: "deployment.mmd" },
  { label: "$(book) ARCHITECTURE.md — the whole picture as a document", format: "ARCHITECTURE.md" },
  { label: "$(book) DATA-MODEL.md", format: "DATA-MODEL.md" },
  { label: "$(book) FLOWS.md", format: "FLOWS.md" },
] as const;

/**
 * "ClarifyDoc: Create Architecture Diagram" — one command, one picture of the
 * workspace, drawn from the analysis rather than guessed: the engine's own
 * export (`clarifydoc export`), so the diagram matches the report and can be
 * committed. A Mermaid diagram opens in a panel that renders it and saves it
 * (as Mermaid, Markdown or SVG) through the editor's own dialog; a document
 * opens as Markdown.
 */
export async function createArchitectureDiagram(state: ExtensionState, target?: unknown): Promise<void> {
  const folder = await pickWorkspaceFolder(target);
  if (!folder) return;
  if (!existsSync(summaryPath(state.context, folder))) {
    const run = await vscode.window.showInformationMessage("ClarifyDoc: this folder has not been analyzed yet.", "Analyze");
    if (run) await vscode.commands.executeCommand("clarifydoc.analyze", folder);
    return;
  }
  const choice = await vscode.window.showQuickPick(CHOICES.map((c) => ({ ...c })), { placeHolder: "Which picture of the architecture?" });
  if (!choice) return;
  const cli = await resolveCli(state.context.extensionPath);
  const res = await runClarifyDoc(cli, ["export", folder.uri.fsPath, "--analysis-dir", resultsDir(state.context, folder), "--format", choice.format], { cwd: folder.uri.fsPath });
  if (res.code !== 0 || !res.stdout.trim()) {
    void vscode.window.showErrorMessage(`ClarifyDoc: could not export ${choice.format}: ${res.stderr.trim() || "no output"}`);
    return;
  }
  if (choice.format.endsWith(".md")) {
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: res.stdout });
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand("markdown.showPreviewToSide");
    return;
  }
  showDiagram(state, folder, choice.format, res.stdout);
}

/**
 * "Sequence": what a route does, in order, as a Mermaid sequence diagram
 * (`clarifydoc seq`) — its handler, the calls it makes, the tables it reads
 * and writes, the HTTP calls it makes into another tier. From a route's
 * CodeLens (the route given), or the command palette (a route picked).
 */
export async function showSequence(state: ExtensionState, target?: unknown, route?: string, file?: string): Promise<void> {
  const folder = await pickWorkspaceFolder(target);
  if (!folder) return;
  if (!existsSync(summaryPath(state.context, folder))) {
    void vscode.window.showInformationMessage("ClarifyDoc: analyze this folder first.");
    return;
  }
  if (!route) {
    const analysis = await loadAnalysis(state.context, folder);
    const api = (analysis?.routes ?? []).filter((r) => r.httpMethod && r.kind !== "frontend");
    const picked = await vscode.window.showQuickPick(
      api.map((r) => ({ label: `${r.httpMethod} ${r.path}`, description: r.filePath ? `${r.filePath}:${r.line}` : "", route: `${r.httpMethod} ${r.path}`, file: r.filePath })),
      { placeHolder: "Which route's sequence?" },
    );
    if (!picked) return;
    route = picked.route;
    file = picked.file ?? undefined;
  }
  const cli = await resolveCli(state.context.extensionPath);
  const args = ["seq", folder.uri.fsPath, "--route", route, "--analysis-dir", resultsDir(state.context, folder), ...(file ? ["--file", file] : [])];
  const res = await runClarifyDoc(cli, args, { cwd: folder.uri.fsPath });
  if (res.code !== 0 || !res.stdout.trim()) {
    void vscode.window.showErrorMessage(`ClarifyDoc: no sequence for ${route}: ${res.stderr.trim().split("\n").pop() || "no output"}`);
    return;
  }
  const save = `sequence-${route.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}`;
  showDiagram(state, folder, `sequence of ${route}${file ? ` (${path.basename(file)})` : ""}`, res.stdout, save);
}

/**
 * One diagram panel. `views` gives the same picture at more than one level
 * (functions, files): the panel switches between them, Save and Copy take the
 * one on screen, and a node that names a source location opens it on click.
 */
export function showDiagram(
  state: ExtensionState,
  folder: vscode.WorkspaceFolder,
  format: string,
  mermaid: string,
  saveName?: string,
  extra: { views?: GraphView[]; meta?: string } = {},
): void {
  const views: GraphView[] = extra.views?.length ? extra.views : [{ label: format, mermaid, nodes: {} }];
  let current = 0;
  const panel = vscode.window.createWebviewPanel("clarifydoc.diagram", `${folder.name}: ${format}`, vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(state.context.extensionUri, "media")],
  });
  const uri = (...p: string[]) => panel.webview.asWebviewUri(vscode.Uri.joinPath(state.context.extensionUri, "media", ...p));
  const nonce = randomBytes(16).toString("base64");
  const csp = `default-src 'none'; img-src ${panel.webview.cspSource} data:; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const payload = JSON.stringify({ views: views.map((v) => ({ label: v.label, diagram: v.mermaid, nodes: Object.keys(v.nodes) })) }).replace(/</g, "\\u003c");
  panel.webview.html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${uri("controlFlow.css")}"><title>${format}</title></head>
<body>
  <header class="cf-header">
    <h1>${escapeHtml(folder.name)} — ${escapeHtml(format)}</h1>
    <p class="cf-meta">${escapeHtml(extra.meta ?? "From the ClarifyDoc analysis (static analysis of the source).")}</p>
    ${views.length > 1 ? `<p class="dg-views">${views.map((v, i) => `<button type="button" class="cf-link dg-view${i === 0 ? " dg-current" : ""}" data-view="${i}">${escapeHtml(v.label)}</button>`).join(" ")}</p>` : ""}
    <button type="button" id="dg-save-mermaid" class="cf-link">Save as Mermaid / Markdown</button>
    <button type="button" id="dg-save-svg" class="cf-link">Save as SVG</button>
    <button type="button" id="dg-copy" class="cf-link">Copy Mermaid</button>
  </header>
  <div id="dg-graph" class="cf-graph"></div>
  <script nonce="${nonce}" type="application/json" id="dg-payload">${payload}</script>
  <script nonce="${nonce}" src="${uri("vendor", "mermaid.min.js")}"></script>
  <script nonce="${nonce}" src="${uri("diagram.js")}"></script>
</body></html>`;
  panel.webview.onDidReceiveMessage(async (m: { type: string; format?: string; svg?: string; view?: number; node?: string }) => {
    if (typeof m.view === "number" && views[m.view]) current = m.view;
    const mermaid = views[current]!.mermaid;
    if (m.type === "open" && m.node) {
      const at = views[current]!.nodes[m.node];
      if (at) void openSourceAt(path.join(folder.uri.fsPath, at.file), at.line, vscode.ViewColumn.One);
      return;
    }
    if (m.type === "copy") {
      await vscode.env.clipboard.writeText(mermaid);
      vscode.window.setStatusBarMessage("ClarifyDoc: diagram copied as Mermaid", 2500);
      return;
    }
    if (m.type !== "save") return;
    const svg = m.format === "svg";
    if (svg && !m.svg) return;
    const base = (saveName ?? format.replace(/\.mmd$/, "")) + (views.length > 1 ? `-${views[current]!.label.toLowerCase()}` : "");
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(folder.uri, svg ? `${base}.svg` : `${base}.md`),
      filters: svg ? { SVG: ["svg"] } : { Markdown: ["md"], Mermaid: ["mmd"] },
    });
    if (!target) return;
    const text = svg ? m.svg! : target.path.endsWith(".md") ? "```mermaid\n" + mermaid.trimEnd() + "\n```\n" : mermaid;
    await vscode.workspace.fs.writeFile(target, Buffer.from(text, "utf8"));
    vscode.window.setStatusBarMessage(`ClarifyDoc: saved ${target.fsPath}`, 3000);
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
