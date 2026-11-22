import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { loadAnalysis, RouteInfo } from "./analysisData";
import { callersOf } from "./crossTier";
import { callerLocations } from "./apiCallProvider";
import { absFor } from "./reveal";
import { showReport } from "./report";
import { suppressionLine } from "./comments";
import { alreadySuppressed, fullRoute, reachingRoutes } from "./treeActions";
import { curlText, httpFileText } from "./tryIt";
import { itemReportHash, type Node } from "./treeView";

/** A route from a tree item or a CodeLens: `{ folder, route }`. */
type RouteArg = Node | { folder?: vscode.WorkspaceFolder; route?: RouteInfo } | undefined;

async function routeOf(state: ExtensionState, arg: RouteArg): Promise<{ folder: vscode.WorkspaceFolder; route: RouteInfo } | undefined> {
  const folder = arg?.folder;
  if (!folder || !arg?.route) return undefined;
  const a = await loadAnalysis(state.context, folder);
  return { folder, route: fullRoute(a?.routes ?? [], arg.route) };
}

/** Sidebar actions on route and security items, and "Try it" on a route. */
export function registerTreeItemCommands(state: ExtensionState, register: (id: string, fn: (...args: any[]) => any) => void): void {
  register("clarifydoc.treeItemFindCallers", async (arg?: RouteArg) => {
    const hit = await routeOf(state, arg);
    if (!hit) return;
    const { folder, route } = hit;
    const facts = (await loadAnalysis(state.context, folder))?.byFile.get(route.filePath);
    const callers = facts ? callersOf(facts, route) : [];
    if (callers.length === 0) {
      void vscode.window.showInformationMessage(`ClarifyDoc: no call in this workspace reaches ${route.httpMethod ?? ""} ${route.path}`.replace("  ", " "));
      return;
    }
    const uri = vscode.Uri.file(absFor(folder, route.filePath));
    await vscode.commands.executeCommand("editor.action.showReferences", uri, new vscode.Position(Math.max(0, route.line - 1), 0), callerLocations(state, folder, callers));
  });

  register("clarifydoc.treeItemShowRoute", async (node?: Node) => {
    const hash = node ? itemReportHash(node, "routes") : undefined;
    if (node?.folder && hash) await showReport(state, node.folder, { hash });
  });

  register("clarifydoc.treeItemSuppress", async (node?: Node) => {
    const f = node?.finding;
    if (!node?.folder || !f) return;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absFor(node.folder, f.filePath)));
    const line = f.line - 1;
    if (line < 0 || line >= doc.lineCount) return;
    const insert = suppressionLine(doc.languageId, doc.lineAt(line).text);
    if (!insert) {
      void vscode.window.showInformationMessage(`ClarifyDoc: ${doc.languageId} has no line comment to suppress with; add the suppression by hand.`);
      return;
    }
    const lines = Array.from({ length: Math.min(doc.lineCount, line + 1) }, (_v, i) => doc.lineAt(i).text);
    if (alreadySuppressed(lines, line)) return;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(line, 0), insert);
    await vscode.workspace.applyEdit(edit);
    await vscode.window.showTextDocument(doc, { selection: new vscode.Range(line, 0, line, 0) });
    void vscode.window.setStatusBarMessage("ClarifyDoc: suppression comment added; re-analyze to apply it", 4000);
  });

  register("clarifydoc.treeItemReachingRoutes", async (node?: Node) => {
    const f = node?.finding;
    if (!node?.folder || !f) return;
    const a = await loadAnalysis(state.context, node.folder);
    const routes = reachingRoutes(a?.routes ?? [], f);
    if (routes.length === 0) {
      void vscode.window.showInformationMessage("ClarifyDoc: no route's handler reaches this finding.");
      return;
    }
    const at = vscode.Uri.file(absFor(node.folder, f.filePath));
    const places = routes.map((r) => new vscode.Location(vscode.Uri.file(absFor(node.folder!, r.filePath)), new vscode.Position(Math.max(0, r.line - 1), 0)));
    await vscode.commands.executeCommand("editor.action.showReferences", at, new vscode.Position(Math.max(0, f.line - 1), 0), places);
  });

  // "Try it": nothing is sent. The request is text the reader edits and sends from their own tool.
  register("clarifydoc.tryItRoute", async (arg?: RouteArg) => {
    const hit = await routeOf(state, arg);
    if (!hit) return;
    const doc = await vscode.workspace.openTextDocument({ language: "http", content: httpFileText(hit.route) });
    await vscode.window.showTextDocument(doc, { preview: false });
  });
  register("clarifydoc.copyRouteAsCurl", async (arg?: RouteArg) => {
    const hit = await routeOf(state, arg);
    if (!hit) return;
    await vscode.env.clipboard.writeText(curlText(hit.route));
    vscode.window.setStatusBarMessage("ClarifyDoc: curl command copied (set BASE_URL and any other variables it uses)", 3500);
  });
}
