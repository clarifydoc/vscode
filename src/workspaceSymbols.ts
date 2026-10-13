import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { loadAnalysis } from "./analysisData";
import { absFor } from "./reveal";
import { lineIn } from "./docFacts";
import { matchRows, symbolRows, SymbolRowKind } from "./symbolSearch";

const CAP = 200;

const KIND: Record<SymbolRowKind, vscode.SymbolKind> = {
  "api-route": vscode.SymbolKind.Method,
  "frontend-route": vscode.SymbolKind.Class,
  screen: vscode.SymbolKind.Class,
  entity: vscode.SymbolKind.Struct,
};

/**
 * Go to Symbol in Workspace (Ctrl+T) for what the analysis knows and a
 * language server does not: API routes by URL (`GET /api/orders/{id}`),
 * screens by name or route, and data entities by name.
 */
export class ClarifyDocWorkspaceSymbols implements vscode.WorkspaceSymbolProvider {
  constructor(private readonly state: ExtensionState) {}

  async provideWorkspaceSymbols(query: string): Promise<vscode.SymbolInformation[]> {
    const out: vscode.SymbolInformation[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const analysis = await loadAnalysis(this.state.context, folder);
      if (!analysis) continue;
      for (const row of matchRows(symbolRows(analysis), query, CAP - out.length)) {
        const uri = vscode.Uri.file(absFor(folder, row.file));
        const line = lineIn(this.state, uri, row.line);
        out.push(
          new vscode.SymbolInformation(row.name, KIND[row.kind], row.container, new vscode.Location(uri, new vscode.Position(line, 0))),
        );
      }
      if (out.length >= CAP) break;
    }
    return out;
  }
}
