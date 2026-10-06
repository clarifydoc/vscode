import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { loadAnalysis, loadFileIndex, linkCommands, relPathOf, FileFacts, FileIndex } from "./analysisData";
import { supportsControlFlow } from "./controlFlowSupport";

function enabled(scope: vscode.Uri): boolean {
  return vscode.workspace.getConfiguration("clarifydoc.codeLens", scope).get<boolean>("enabled") ?? true;
}
function complexityThreshold(scope: vscode.Uri): number {
  return vscode.workspace.getConfiguration("clarifydoc.diagnostics", scope).get<number>("complexityThreshold") ?? 15;
}

/**
 * CodeLens above functions (callers / callees / complexity / open-traces),
 * classes (references) and routes (method + path + handler → open the report).
 * Lenses only appear where the analyzer has something to say, so trivial code
 * stays uncluttered.
 */
export class ClarifyDocCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(private readonly state: ExtensionState) {
    state.context.subscriptions.push(
      this.emitter,
      state.onAnalysisChanged(() => this.emitter.fire()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("clarifydoc.codeLens") || e.affectsConfiguration("clarifydoc.diagnostics")) {
          this.emitter.fire();
        }
      }),
    );
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (!enabled(document.uri)) return [];
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return [];
    const rel = relPathOf(folder, document.uri);
    if (!rel) return [];
    const analysis = await loadAnalysis(this.state.context, folder);
    const facts = analysis?.byFile.get(rel);
    if (!facts) return [];

    const threshold = complexityThreshold(document.uri);
    const lenses: vscode.CodeLens[] = [];
    const uriArg = document.uri.toString();

    const idx = await loadFileIndex(this.state.context, folder, rel, facts);
    this.definitionLenses(idx, document, uriArg, threshold, lenses, supportsControlFlow(document));
    this.routeLenses(facts, document, lenses);
    return lenses;
  }

  private definitionLenses(
    idx: FileIndex,
    doc: vscode.TextDocument,
    uriArg: string,
    threshold: number,
    out: vscode.CodeLens[],
    canDrawControlFlow: boolean,
  ): void {
    for (const def of idx.defs) {
      const links = linkCommands(idx, def, uriArg);
      const hot = def.complexity !== undefined && def.complexity >= threshold;
      if (links.length === 0 && !hot) continue; // keep trivial code clean

      const range = new vscode.Range(Math.max(0, def.line - 1), 0, Math.max(0, def.line - 1), 0);
      for (const command of links) out.push(new vscode.CodeLens(range, command));
      if (def.kind === "class") continue;
      if (hot) {
        // The number alone tells a reader the function is bad, not where, so
        // the lens goes to the control-flow view — the same number with its
        // structure attached (the Complexity tab is a click away inside it).
        //
        // Not every language can be drawn: a graph needs an AST, and most of
        // the 35 are extracted by regex. Those keep the lens they always had
        // rather than one that leads to a view saying it cannot help.
        out.push(new vscode.CodeLens(range, canDrawControlFlow
          ? {
              title: `$(flame) complexity ${def.complexity}`,
              command: "clarifydoc.showControlFlow",
              arguments: [uriArg, def.symbol, def.line],
            }
          : {
              title: `$(flame) complexity ${def.complexity}`,
              command: "clarifydoc.openReportForFile",
              arguments: [doc.uri, "complexity"],
            }));
      }
      out.push(new vscode.CodeLens(range, {
        title: "$(list-tree) Traces",
        command: "clarifydoc.openReportForFile",
        arguments: [doc.uri, "traces"],
      }));
    }
  }

  private routeLenses(facts: FileFacts, doc: vscode.TextDocument, out: vscode.CodeLens[]): void {
    for (const r of facts.routes) {
      const range = new vscode.Range(Math.max(0, r.line - 1), 0, Math.max(0, r.line - 1), 0);
      const title = `$(globe) ${[r.httpMethod, r.path].filter(Boolean).join(" ")}${r.handler ? ` → ${r.handler}` : ""}`;
      out.push(new vscode.CodeLens(range, {
        title,
        command: "clarifydoc.openReportForFile",
        arguments: [doc.uri, "routes"],
      }));
    }
  }
}
