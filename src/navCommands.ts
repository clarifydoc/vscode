import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { showReport } from "./report";
import { loadAnalysis, loadFileIndex, relPathOf } from "./analysisData";
import { openSourceAt, absFor } from "./reveal";

const FILE_TABS = new Set(["ui", "traces", "blast"]);

/** Open the report for a file's uri, deep-linked to `tab` (file-focused where supported).
 *  Accepts a Uri (from CodeLens) or a string (from a Markdown command: link in a hover). */
export async function openReportForFile(state: ExtensionState, uri: vscode.Uri | string, tab: string): Promise<void> {
  if (typeof uri === "string") uri = vscode.Uri.parse(uri);
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return;
  const rel = relPathOf(folder, uri);
  const hash = rel && FILE_TABS.has(tab) ? `${tab}~${encodeURIComponent(rel)}` : tab;
  await showReport(state, folder, { hash });
}

/**
 * Quick-pick the callers or callees of a symbol (resolved by the analyzer's
 * symbolLinks) and jump to the chosen definition/call site in the editor.
 */
export async function showLinkedSymbols(
  state: ExtensionState,
  uriString: string,
  symbol: string,
  direction: "callers" | "callees",
): Promise<void> {
  const uri = vscode.Uri.parse(uriString);
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return;
  const rel = relPathOf(folder, uri);
  if (!rel) return;
  const facts = (await loadAnalysis(state.context, folder))?.byFile.get(rel);
  if (!facts) return;

  const idx = await loadFileIndex(state.context, folder, rel, facts);
  const items = (idx[direction].get(symbol) ?? []).map((e) => (
    { label: e.symbol || "(anonymous)", description: `${e.file}:${e.line}`, file: e.file, line: e.line }
  ));

  if (items.length === 0) {
    void vscode.window.showInformationMessage(`ClarifyDoc: no ${direction} found for ${symbol}.`);
    return;
  }
  if (items.length === 1) {
    await openSourceAt(absFor(folder, items[0].file), items[0].line);
    return;
  }
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `${direction === "callers" ? "Callers" : "Callees"} of ${symbol}`,
    matchOnDescription: true,
  });
  if (pick) await openSourceAt(absFor(folder, pick.file), pick.line);
}
