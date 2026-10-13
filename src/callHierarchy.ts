import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { Definition, loadFileIndex, ResolvedAnalysis } from "./analysisData";
import { absFor } from "./reveal";
import { docFacts, lineIn } from "./docFacts";
import { CallEdge, edgeDetail, incomingCalls, outgoingCalls } from "./callGraph";

/** A hierarchy item that remembers where in the analysis it came from. */
class Item extends vscode.CallHierarchyItem {
  constructor(
    readonly folder: vscode.WorkspaceFolder,
    readonly analysis: ResolvedAnalysis,
    /** Project-relative file. */
    readonly file: string,
    /** The symbol as the analysis spells it: `fn`, `Class.method`. */
    readonly symbol: string,
    kind: vscode.SymbolKind,
    detail: string,
    uri: vscode.Uri,
    range: vscode.Range,
  ) {
    super(kind, symbol, detail, uri, range, range);
  }
}

/**
 * The call hierarchy (Show Call Hierarchy, Peek Incoming/Outgoing Calls) from
 * the calls the analyzer resolved — including across the HTTP boundary, so
 * the incoming calls of a controller action are the frontend functions that
 * call its route, and climbing on reaches the components that call those.
 * Each entry's detail says how sure the link is and how it was made.
 */
export class ClarifyDocCallHierarchyProvider implements vscode.CallHierarchyProvider {
  constructor(private readonly state: ExtensionState) {}

  async prepareCallHierarchy(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.CallHierarchyItem | undefined> {
    const d = await docFacts(this.state, doc);
    if (!d) return undefined;
    const idx = await loadFileIndex(this.state.context, d.folder, d.rel, d.facts);
    const wordRange = doc.getWordRangeAtPosition(pos);
    const word = wordRange ? doc.getText(wordRange) : "";
    const onLine = idx.defs.filter((x) => d.isAt(x.line, pos.line));
    const def =
      onLine.find((x) => x.symbol === word || x.symbol.endsWith(`.${word}`)) ??
      onLine[0] ??
      // Anywhere in the body: the nearest definition above the cursor.
      [...idx.defs].reverse().find((x) => x.kind === "function" && (this.state.lines.map(doc.uri, x.line - 1) ?? Infinity) <= pos.line);
    if (!def) return undefined;
    return this.item(d.folder, d.analysis, d.rel, def.symbol, def, d.rel);
  }

  async provideCallHierarchyIncomingCalls(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyIncomingCall[]> {
    if (!(item instanceof Item)) return [];
    const facts = item.analysis.byFile.get(item.file);
    if (!facts) return [];
    const out: vscode.CallHierarchyIncomingCall[] = [];
    for (const edge of incomingCalls(facts, item.symbol)) {
      const caller = await this.itemFor(item, edge);
      const uri = vscode.Uri.file(absFor(item.folder, edge.file));
      out.push(new vscode.CallHierarchyIncomingCall(caller, edge.sites.map((s) => lineRange(this.state, uri, s))));
    }
    return out;
  }

  async provideCallHierarchyOutgoingCalls(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyOutgoingCall[]> {
    if (!(item instanceof Item)) return [];
    const facts = item.analysis.byFile.get(item.file);
    if (!facts) return [];
    const out: vscode.CallHierarchyOutgoingCall[] = [];
    for (const edge of outgoingCalls(facts, item.symbol)) {
      const callee = await this.itemFor(item, edge);
      out.push(new vscode.CallHierarchyOutgoingCall(callee, edge.sites.map((s) => lineRange(this.state, item.uri, s))));
    }
    return out;
  }

  /** The item at the other end of an edge, placed at its definition when known. */
  private async itemFor(from: Item, edge: CallEdge): Promise<Item> {
    let def: Definition | undefined;
    const facts = from.analysis.byFile.get(edge.file);
    if (facts) {
      const idx = await loadFileIndex(this.state.context, from.folder, edge.file, facts);
      def = idx.defs.find((x) => x.symbol === edge.symbol);
    }
    const line = def?.line ?? edge.line ?? edge.sites[0] ?? 1;
    const detail = [edge.file, edgeDetail(edge.links)].filter(Boolean).join(" · ");
    return this.item(from.folder, from.analysis, edge.file, edge.symbol, def ?? { line }, detail);
  }

  private item(
    folder: vscode.WorkspaceFolder,
    analysis: ResolvedAnalysis,
    file: string,
    symbol: string,
    def: Pick<Definition, "line"> & Partial<Definition>,
    detail: string,
  ): Item {
    const uri = vscode.Uri.file(absFor(folder, file));
    // `route:GET /x` stands for a route whose handler has no name of its own.
    const kind = symbol.startsWith("route:")
      ? vscode.SymbolKind.Event
      : def.kind === "class"
        ? vscode.SymbolKind.Class
        : symbol.includes(".")
          ? vscode.SymbolKind.Method
          : vscode.SymbolKind.Function;
    return new Item(folder, analysis, file, symbol, kind, detail, uri, lineRange(this.state, uri, def.line));
  }
}

function lineRange(state: ExtensionState, uri: vscode.Uri, line1: number): vscode.Range {
  const line = lineIn(state, uri, line1);
  return new vscode.Range(line, 0, line, 0);
}
