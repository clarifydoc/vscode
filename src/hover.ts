import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { loadAnalysis, relPathOf } from "./analysisData";

function enabled(scope: vscode.Uri): boolean {
  return vscode.workspace.getConfiguration("clarifydoc.hover", scope).get<boolean>("enabled") ?? true;
}

function cmd(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}

/**
 * On hover, show a compact ClarifyDoc card for the symbol under the cursor:
 * complexity, caller/callee counts, and any security finding on this line, with
 * command links into the report / caller-callee pickers.
 */
export class ClarifyDocHoverProvider implements vscode.HoverProvider {
  constructor(private readonly state: ExtensionState) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    if (!enabled(document.uri)) return undefined;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return undefined;
    const rel = relPathOf(folder, document.uri);
    const analysis = rel ? await loadAnalysis(this.state.context, folder) : undefined;
    const facts = rel ? analysis?.byFile.get(rel) : undefined;
    if (!facts) return undefined;

    const wordRange = document.getWordRangeAtPosition(position);
    const word = wordRange ? document.getText(wordRange) : "";
    const line1 = position.line + 1;

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportThemeIcons = true;
    let any = false;

    const fn = facts.functions.find((f) => f.functionName === word)
      ?? facts.functions.find((f) => f.line === line1);
    if (fn) {
      any = true;
      const callers = facts.inbound.filter((l) => l.targetSymbol === fn.functionName).length;
      const callees = facts.outbound.filter((l) => l.sourceSymbol === fn.functionName).length;
      md.appendMarkdown(`**$(symbol-method) ${fn.functionName}** — complexity **${fn.complexity}**\n\n`);
      const links: string[] = [];
      if (callers > 0) links.push(`[$(arrow-left) ${callers} callers](${cmd("clarifydoc.showCallers", [document.uri.toString(), fn.functionName])})`);
      if (callees > 0) links.push(`[$(arrow-right) ${callees} callees](${cmd("clarifydoc.showCallees", [document.uri.toString(), fn.functionName])})`);
      links.push(`[$(list-tree) Traces](${cmd("clarifydoc.openReportForFile", [document.uri.toString(), "traces"])})`);
      md.appendMarkdown(links.join(" · "));
    }

    const issues = facts.security.filter((s) => s.line === line1);
    if (issues.length) {
      any = true;
      if (fn) md.appendMarkdown("\n\n");
      for (const s of issues) {
        md.appendMarkdown(`\n\n$(shield) **${s.severity}** ${s.category}: ${s.message}`);
      }
    }

    const routes = facts.routes.filter((r) => r.line === line1);
    if (routes.length) {
      any = true;
      for (const r of routes) {
        md.appendMarkdown(`\n\n$(globe) **${[r.httpMethod, r.path].filter(Boolean).join(" ")}**${r.handler ? ` → ${r.handler}` : ""}`);
      }
    }

    return any ? new vscode.Hover(md, wordRange) : undefined;
  }
}
