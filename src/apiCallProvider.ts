import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { absFor } from "./reveal";
import { callersOf, callsAtLine, linksAtLine, navigableLinks, urlRange } from "./crossTier";
import { crossTierEnabled, docFacts, lineIn } from "./docFacts";
import { ApiRouteLink, FileFacts } from "./analysisData";
import { editorPassActive } from "./editorLspCore";

/** The calls whose analyzed line is now at `line`, with the links they made. */
function callLinksAt(facts: FileFacts, line: number, isAt: (analyzed: number, line: number) => boolean) {
  const analyzed = facts.callsRoutes.find((l) => isAt(l.sourceLine, line))?.sourceLine;
  if (analyzed === undefined) return undefined;
  return { links: linksAtLine(facts, analyzed), calls: callsAtLine(facts, analyzed) };
}

/**
 * F12 on an API call goes to the backend route that serves it — across
 * languages and projects, through the link the analyzer made. Answers only on
 * the URL as written when it can be found on the line, so the language's own
 * definitions keep the rest of it. An AMBIGUOUS link names only the first of
 * several routes, so it is never offered; a call the analyzer could not place
 * offers nothing.
 */
export class ApiCallDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly state: ExtensionState) {}

  async provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.DefinitionLink[] | undefined> {
    if (editorPassActive() || !crossTierEnabled(doc.uri)) return undefined;
    const d = await docFacts(this.state, doc);
    if (!d) return undefined;
    const at = callLinksAt(d.facts, pos.line, d.isAt);
    if (!at) return undefined;
    const links = navigableLinks(at.links);
    if (links.length === 0) return undefined;

    const text = doc.lineAt(pos.line).text;
    const found = urlRange(text, [...at.calls.map((c) => c.target), ...at.links.map((l) => l.url)]);
    if (found && (pos.character < found.start || pos.character > found.end)) return undefined;
    const origin = found
      ? new vscode.Range(pos.line, found.start, pos.line, found.end)
      : doc.lineAt(pos.line).range;

    return links.map((l) => {
      const targetUri = vscode.Uri.file(absFor(d.folder, l.target));
      const line = lineIn(this.state, targetUri, l.targetLine);
      return {
        originSelectionRange: origin,
        targetUri,
        targetRange: new vscode.Range(line, 0, line, 0),
      };
    });
  }
}

/** The call sites of the links that reach a route, as editor locations. */
export function callerLocations(state: ExtensionState, folder: vscode.WorkspaceFolder, links: ApiRouteLink[]): vscode.Location[] {
  return links.map((l) => {
    const uri = vscode.Uri.file(absFor(folder, l.source));
    const line = lineIn(state, uri, l.sourceLine);
    return new vscode.Location(uri, new vscode.Position(line, 0));
  });
}

/**
 * Shift+F12 on a route lists the calls that reach it — the frontend code that
 * calls this endpoint, wherever it lives.
 */
export class RouteReferenceProvider implements vscode.ReferenceProvider {
  constructor(private readonly state: ExtensionState) {}

  async provideReferences(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Location[] | undefined> {
    if (editorPassActive() || !crossTierEnabled(doc.uri)) return undefined;
    const d = await docFacts(this.state, doc);
    if (!d) return undefined;
    const routes = d.facts.routes.filter((r) => d.isAt(r.line, pos.line));
    if (routes.length === 0) return undefined;
    const callers = routes.flatMap((r) => callersOf(d.facts, r));
    return callers.length ? callerLocations(this.state, d.folder, callers) : undefined;
  }
}
