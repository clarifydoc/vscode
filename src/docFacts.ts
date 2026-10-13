import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { FileFacts, loadAnalysis, relPathOf, ResolvedAnalysis } from "./analysisData";

/** A document's place in the latest analysis. */
export interface DocFacts {
  folder: vscode.WorkspaceFolder;
  /** Project-relative, forward-slashed. */
  rel: string;
  analysis: ResolvedAnalysis;
  facts: FileFacts;
  /** Whether an analyzed (1-based) line is, after edits since the analysis, at `line` (0-based). */
  isAt(analyzedLine: number, line: number): boolean;
}

/** The analysis facts for a document, or undefined when it has none. */
export async function docFacts(state: ExtensionState, doc: vscode.TextDocument): Promise<DocFacts | undefined> {
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (!folder) return undefined;
  const rel = relPathOf(folder, doc.uri);
  if (!rel) return undefined;
  const analysis = await loadAnalysis(state.context, folder);
  const facts = analysis?.byFile.get(rel);
  if (!analysis || !facts) return undefined;
  return {
    folder,
    rel,
    analysis,
    facts,
    isAt: (analyzedLine, line) => state.lines.map(doc.uri, analyzedLine - 1) === line,
  };
}

/** Where an analyzed (1-based) line of another file is, following that file's edits. */
export function lineIn(state: ExtensionState, uri: vscode.Uri, analyzedLine: number): number {
  return state.lines.map(uri, Math.max(0, analyzedLine - 1)) ?? Math.max(0, analyzedLine - 1);
}

export function crossTierEnabled(scope: vscode.Uri): boolean {
  return vscode.workspace.getConfiguration("clarifydoc.crossTier", scope).get<boolean>("enabled") ?? true;
}
