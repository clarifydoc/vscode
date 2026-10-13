import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { loadFileIndex, ResolvedAnalysis } from "./analysisData";
import { absFor } from "./reveal";
import { docFacts, lineIn } from "./docFacts";
import { TypeEdge, TypeNode, typeId } from "./typeGraph";

class Item extends vscode.TypeHierarchyItem {
  constructor(
    readonly folder: vscode.WorkspaceFolder,
    readonly analysis: ResolvedAnalysis,
    readonly node: TypeNode,
    detail: string,
    uri: vscode.Uri,
    range: vscode.Range,
  ) {
    super(node.isInterface ? vscode.SymbolKind.Interface : vscode.SymbolKind.Class, node.name, detail, uri, range, range);
  }
}

/**
 * The type hierarchy (Show Type Hierarchy) from the analyzer's class graph —
 * `extends` and `implements` between the project's own types, in any language
 * the analyzer reads. Like the call hierarchy it answers only where no
 * language provides one.
 */
export class ClarifyDocTypeHierarchyProvider implements vscode.TypeHierarchyProvider {
  constructor(private readonly state: ExtensionState) {}

  async prepareTypeHierarchy(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.TypeHierarchyItem | undefined> {
    const d = await docFacts(this.state, doc);
    if (!d) return undefined;
    const idx = await loadFileIndex(this.state.context, d.folder, d.rel, d.facts);
    const wordRange = doc.getWordRangeAtPosition(pos);
    const word = wordRange ? doc.getText(wordRange) : "";
    const classes = idx.defs.filter((x) => x.kind === "class");
    const def = classes.find((x) => x.symbol === word) ?? classes.find((x) => d.isAt(x.line, pos.line));
    const node = def && d.analysis.types.byId.get(typeId(d.rel, def.symbol));
    if (!node) return undefined;
    return this.item(d.folder, d.analysis, node, d.rel, def.line);
  }

  async provideTypeHierarchySupertypes(item: vscode.TypeHierarchyItem): Promise<vscode.TypeHierarchyItem[]> {
    return item instanceof Item ? this.items(item, item.analysis.types.supertypes(item.node.id)) : [];
  }

  async provideTypeHierarchySubtypes(item: vscode.TypeHierarchyItem): Promise<vscode.TypeHierarchyItem[]> {
    return item instanceof Item ? this.items(item, item.analysis.types.subtypes(item.node.id)) : [];
  }

  private async items(from: Item, edges: TypeEdge[]): Promise<Item[]> {
    const out: Item[] = [];
    for (const e of edges) {
      const facts = from.analysis.byFile.get(e.node.file);
      const idx = facts && (await loadFileIndex(this.state.context, from.folder, e.node.file, facts));
      const line = idx?.defs.find((x) => x.kind === "class" && x.symbol === e.node.name)?.line ?? 1;
      out.push(this.item(from.folder, from.analysis, e.node, `${e.relation} · ${e.node.file}`, line));
    }
    return out;
  }

  private item(folder: vscode.WorkspaceFolder, analysis: ResolvedAnalysis, node: TypeNode, detail: string, line1: number): Item {
    const uri = vscode.Uri.file(absFor(folder, node.file));
    const line = lineIn(this.state, uri, line1);
    return new Item(folder, analysis, node, detail, uri, new vscode.Range(line, 0, line, 0));
  }
}
