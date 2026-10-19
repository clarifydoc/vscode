import * as vscode from "vscode";
import { loadAnalysis, loadFileIndex, relPathOf } from "./analysisData";
import { showDiagram } from "./architectureDiagram";
import { filesGraph, type GraphFile } from "./filesGraph";
import { ExtensionState } from "./state";

/** More than this and the picture stops being readable; the rest are named in the panel. */
const MAX_FILES = 40;

/**
 * "Show in a Graph" (VSCODE 9.2): the files selected in the Explorer — or the
 * active editor's — with their functions, the calls between them, what
 * reaches in and out of the selection, and the HTTP calls across tiers. A
 * selected folder stands for the analyzed files under it.
 */
export async function showFilesGraph(state: ExtensionState, uri?: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
  const picked = (uris?.length ? uris : uri ? [uri] : vscode.window.activeTextEditor ? [vscode.window.activeTextEditor.document.uri] : []).filter(
    (u) => u.scheme === "file",
  );
  if (picked.length === 0) {
    void vscode.window.showInformationMessage("ClarifyDoc: select files in the Explorer, or open one, to graph them.");
    return;
  }
  const folder = vscode.workspace.getWorkspaceFolder(picked[0]!);
  if (!folder) {
    void vscode.window.showWarningMessage("ClarifyDoc: the graph needs files inside a workspace folder.");
    return;
  }
  let analysis = await loadAnalysis(state.context, folder);
  if (!analysis) {
    const choice = await vscode.window.showInformationMessage(`ClarifyDoc: ${folder.name} has no analysis yet.`, "Analyze");
    if (choice !== "Analyze") return;
    await vscode.commands.executeCommand("clarifydoc.analyze", folder);
    analysis = await loadAnalysis(state.context, folder);
    if (!analysis) return;
  }

  const others = picked.filter((u) => vscode.workspace.getWorkspaceFolder(u)?.uri.fsPath !== folder.uri.fsPath).length;
  const wanted = new Set<string>();
  for (const u of picked) {
    const rel = relPathOf(folder, u);
    if (rel === undefined) continue;
    // A folder (or the root, rel "") stands for every analyzed file under it.
    if (analysis.files.has(rel)) wanted.add(rel);
    else for (const f of analysis.files) if (rel === "" || f.startsWith(rel + "/")) wanted.add(f);
  }
  const files = [...wanted].sort();
  if (files.length === 0) {
    void vscode.window.showInformationMessage("ClarifyDoc: the analysis has none of the selected files — they may be excluded, or added since it ran.");
    return;
  }
  const kept = files.slice(0, MAX_FILES);

  const input: GraphFile[] = [];
  for (const rel of kept) {
    const facts = analysis.byFile.get(rel);
    if (!facts) {
      input.push({ file: rel, defs: [], outbound: [], inbound: [], callsRoutes: [], servesCalls: [], routes: [] });
      continue;
    }
    const idx = await loadFileIndex(state.context, folder, rel, facts);
    input.push({
      file: rel,
      defs: idx.defs,
      outbound: facts.outbound,
      inbound: facts.inbound,
      callsRoutes: facts.callsRoutes,
      servesCalls: facts.servesCalls,
      routes: facts.routes,
    });
  }
  const g = filesGraph(input);
  const notes = [
    g.summary,
    files.length > kept.length ? `the first ${MAX_FILES} of ${files.length} files` : "",
    others ? `${others} selected item(s) in another workspace folder left out` : "",
    "click a node to open it",
  ].filter(Boolean);
  const title = kept.length === 1 ? kept[0]!.split("/").pop()! : `${kept.length} files`;
  showDiagram(state, folder, title, g.functions.mermaid, "files-graph", { views: [g.functions, g.files], meta: notes.join(" · ") });
}
