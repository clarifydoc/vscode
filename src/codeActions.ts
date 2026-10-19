import * as vscode from "vscode";
import * as path from "path";
import { suppressionLine } from "./comments";

/** Diagnostic codes that are not security findings. */
const COMPLEXITY = "complexity";
const LAYER = "layer-violation";
const DEAD = "dead-code";
const ROUTE_MISS = "route-miss";

function codeOf(d: vscode.Diagnostic): string | undefined {
  const c = d.code;
  if (c === undefined) return undefined;
  return typeof c === "object" ? String(c.value) : String(c);
}

/**
 * Quick fixes on ClarifyDoc's own findings: the next step each one asks for.
 * A security finding can show the API routes that reach it, or be suppressed
 * with the comment the scanner honours; a complex function opens its control
 * flow; a layer violation opens the architecture view; and any finding's
 * folder can be left out of the analysis.
 */
export class ClarifyDocCodeActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const out: vscode.CodeAction[] = [];
    const ours = context.diagnostics.filter((d) => d.source === "ClarifyDoc");
    for (const d of ours) {
      const code = codeOf(d);
      const line = d.range.start.line;
      if (code === COMPLEXITY) {
        out.push(command("Show control flow", d, "clarifydoc.showControlFlow", [doc.uri, undefined, line + 1]));
      } else if (code === LAYER) {
        out.push(command("Open the architecture view", d, "clarifydoc.openReportForFile", [doc.uri, "links"]));
      } else if (code === ROUTE_MISS) {
        // Open the route the backend does serve: the call probably meant it.
        for (const r of (d.relatedInformation ?? []).slice(0, 3)) {
          out.push(command(`Open the route that exists: ${r.message}`, d, "vscode.open", [r.location.uri, { selection: r.location.range }]));
        }
      } else if (code === DEAD) {
        // Nothing to fix in place: deleting code is the reader's decision.
      } else {
        const routes = (d.relatedInformation ?? []).map((r) => r.location);
        if (routes.length) {
          out.push(
            command(
              routes.length === 1 ? "Show the route that reaches this" : `Show the ${routes.length} routes that reach this`,
              d,
              "editor.action.showReferences",
              [doc.uri, d.range.start, routes],
            ),
          );
        }
        const insert = suppressionLine(doc.languageId, doc.lineAt(line).text);
        if (insert) {
          const fix = new vscode.CodeAction("Suppress with clarifydoc-ignore-next-line", vscode.CodeActionKind.QuickFix);
          fix.diagnostics = [d];
          fix.edit = new vscode.WorkspaceEdit();
          fix.edit.insert(doc.uri, new vscode.Position(line, 0), insert);
          out.push(fix);
        }
      }
    }
    // Once per file, not per finding: leave the file's folder out of the analysis.
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const dir = vscode.Uri.file(path.dirname(doc.uri.fsPath));
    if (ours.length && folder && dir.fsPath !== folder.uri.fsPath) {
      const name = path.relative(folder.uri.fsPath, dir.fsPath).split(path.sep).join("/");
      out.push(command(`Ignore the folder ${name} in ClarifyDoc`, undefined, "clarifydoc.ignoreFolder", [dir]));
    }
    return out;
  }
}

function command(title: string, d: vscode.Diagnostic | undefined, id: string, args: unknown[]): vscode.CodeAction {
  const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
  if (d) action.diagnostics = [d];
  action.command = { title, command: id, arguments: args };
  return action;
}
