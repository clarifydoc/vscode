import * as path from "path";
import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { loadAnalysis, loadFileIndex, linkCommands, relPathOf, FileFacts, FileIndex, ResolvedAnalysis } from "./analysisData";
import { callersOf, describeRoute, isUncalled, routeData, screensReaching } from "./crossTier";
import { callerLocations } from "./apiCallProvider";
import { crossTierEnabled } from "./docFacts";
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
    const tests = analysis!.isTest ? { isTest: analysis!.isTest, hasTests: analysis!.hasTests === true } : undefined;
    this.definitionLenses(idx, document, uriArg, threshold, lenses, supportsControlFlow(document), tests);
    this.routeLenses(facts, document, lenses, analysis!, folder);
    return lenses;
  }

  private definitionLenses(
    idx: FileIndex,
    doc: vscode.TextDocument,
    uriArg: string,
    threshold: number,
    out: vscode.CodeLens[],
    canDrawControlFlow: boolean,
    tests?: { isTest: (file: string) => boolean; hasTests: boolean },
  ): void {
    for (const def of idx.defs) {
      const hot = def.complexity !== undefined && def.complexity >= threshold;
      const links = linkCommands(idx, def, uriArg, tests && { ...tests, flagUntested: hot });
      if (links.length === 0 && !hot) continue; // keep trivial code clean

      const range = this.rangeAt(doc, def.line);
      if (!range) continue; // the definition's line was deleted since the analysis
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

  /** Where an analyzed (1-based) line is now, following edits made since the analysis. */
  private rangeAt(doc: vscode.TextDocument, line1: number): vscode.Range | undefined {
    const line = this.state.lines.map(doc.uri, Math.max(0, line1 - 1));
    return line === undefined ? undefined : new vscode.Range(line, 0, line, 0);
  }

  private routeLenses(
    facts: FileFacts,
    doc: vscode.TextDocument,
    out: vscode.CodeLens[],
    analysis: ResolvedAnalysis,
    folder: vscode.WorkspaceFolder,
  ): void {
    const crossTier = crossTierEnabled(doc.uri);
    for (const r of facts.routes) {
      const range = this.rangeAt(doc, r.line);
      if (!range) continue;
      const label = `${[r.httpMethod, r.path].filter(Boolean).join(" ")}${r.handler ? ` → ${r.handler}` : ""}`;
      out.push(new vscode.CodeLens(range, {
        title: `$(globe) ${plain(label)}`,
        command: "clarifydoc.openReportForFile",
        arguments: [doc.uri, "routes"],
      }));
      // What the endpoint does, in order: its handler's calls, tables and outbound HTTP.
      if (r.httpMethod && r.kind !== "frontend") {
        out.push(new vscode.CodeLens(range, {
          title: "$(list-ordered) sequence",
          tooltip: "What this route does, in order, as a sequence diagram",
          command: "clarifydoc.showSequence",
          arguments: [folder, `${r.httpMethod} ${r.path}`, path.relative(folder.uri.fsPath, doc.uri.fsPath).split(path.sep).join("/")],
        }));
      }
      if (!crossTier) continue;

      // Who calls this endpoint, from which screens, and what it stores.
      const callers = callersOf(facts, r);
      const summary = describeRoute(
        callers.length,
        screensReaching(analysis.crossTier, callers),
        routeData(analysis.crossTier, r),
        isUncalled(analysis.crossTier, r),
      );
      if (!summary) continue;
      out.push(new vscode.CodeLens(range, callers.length
        ? {
            title: plain(summary),
            tooltip: "Show the calls that reach this route",
            command: "editor.action.showReferences",
            arguments: [doc.uri, range.start, callerLocations(this.state, folder, callers)],
          }
        : {
            title: plain(summary),
            tooltip: "Open this route in the report",
            command: "clarifydoc.openReportForFile",
            arguments: [doc.uri, "routes"],
          }));
    }
  }
}

/** A lens title shows `$(name)` as an icon; text from the analysis must not. */
function plain(text: string): string {
  return text.replace(/\$\(/g, "$\u200b(");
}
