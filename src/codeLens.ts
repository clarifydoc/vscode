import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { loadAnalysis, relPathOf, FileFacts } from "./analysisData";
import { supportsControlFlow } from "./controlFlowSupport";

function enabled(scope: vscode.Uri): boolean {
  return vscode.workspace.getConfiguration("clarifydoc.codeLens", scope).get<boolean>("enabled") ?? true;
}
function complexityThreshold(scope: vscode.Uri): number {
  return vscode.workspace.getConfiguration("clarifydoc.diagnostics", scope).get<number>("complexityThreshold") ?? 15;
}

/**
 * CodeLens above functions (callers / callees / complexity / open-traces) and
 * routes (method + path + handler → open the report). Lenses only appear where
 * the analyzer has something to say, so trivial code stays uncluttered.
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

    this.functionLenses(facts, document, uriArg, threshold, lenses, supportsControlFlow(document));
    this.routeLenses(facts, document, lenses);
    return lenses;
  }

  private functionLenses(
    facts: FileFacts,
    doc: vscode.TextDocument,
    uriArg: string,
    threshold: number,
    out: vscode.CodeLens[],
    canDrawControlFlow: boolean,
  ): void {
    for (const fn of facts.functions) {
      const callers = facts.inbound.filter((l) => l.targetSymbol === fn.functionName).length;
      const callees = facts.outbound.filter((l) => l.sourceSymbol === fn.functionName).length;
      const hot = fn.complexity >= threshold;
      if (callers === 0 && callees === 0 && !hot) continue; // keep trivial functions clean

      const range = new vscode.Range(Math.max(0, fn.line - 1), 0, Math.max(0, fn.line - 1), 0);
      if (callers > 0) {
        out.push(new vscode.CodeLens(range, {
          title: `$(arrow-left) ${callers} caller${callers === 1 ? "" : "s"}`,
          command: "clarifydoc.showCallers",
          arguments: [uriArg, fn.functionName],
        }));
      }
      if (callees > 0) {
        out.push(new vscode.CodeLens(range, {
          title: `$(arrow-right) ${callees} callee${callees === 1 ? "" : "s"}`,
          command: "clarifydoc.showCallees",
          arguments: [uriArg, fn.functionName],
        }));
      }
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
              title: `$(flame) complexity ${fn.complexity}`,
              command: "clarifydoc.showControlFlow",
              arguments: [uriArg, fn.functionName, fn.line],
            }
          : {
              title: `$(flame) complexity ${fn.complexity}`,
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
