import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { loadAnalysis, loadFileIndex, linkCommands, relPathOf } from "./analysisData";
import { escapeMd } from "./markdown";

/** The only commands the card's links may run. Everything else in it is text. */
const HOVER_COMMANDS = ["clarifydoc.showCallers", "clarifydoc.showCallees", "clarifydoc.openReportForFile"];

function enabled(scope: vscode.Uri): boolean {
  return vscode.workspace.getConfiguration("clarifydoc.hover", scope).get<boolean>("enabled") ?? true;
}

function cmd(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}

/**
 * On hover, show a compact ClarifyDoc card for the symbol under the cursor:
 * complexity (where measured), caller/callee or reference counts, and any
 * security finding on this line, with command links into the report /
 * caller-callee pickers.
 */
export class ClarifyDocHoverProvider implements vscode.HoverProvider {
  constructor(private readonly state: ExtensionState) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    if (!enabled(document.uri)) return undefined;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return undefined;
    const rel = relPathOf(folder, document.uri);
    if (!rel) return undefined;
    const facts = (await loadAnalysis(this.state.context, folder))?.byFile.get(rel);
    if (!facts) return undefined;

    const wordRange = document.getWordRangeAtPosition(position);
    const word = wordRange ? document.getText(wordRange) : "";
    // Analysis lines (1-based) are compared where they are now, so the card
    // still matches after edits made since the analysis.
    const here = (line1: number) => this.state.lines.map(document.uri, line1 - 1) === position.line;

    const md = new vscode.MarkdownString();
    md.isTrusted = { enabledCommands: HOVER_COMMANDS };
    md.supportThemeIcons = true;
    let any = false;

    const idx = await loadFileIndex(this.state.context, folder, rel, facts);
    const def = idx.defs.find((d) => d.symbol === word) ?? idx.defs.find((d) => here(d.line));
    const uriArg = document.uri.toString();
    const links = def ? linkCommands(idx, def, uriArg) : [];
    // A class card is only its references, so it shows when there are some.
    if (def && (def.kind !== "class" || links.length > 0)) {
      any = true;
      const icon = def.kind === "class" ? "symbol-class" : "symbol-method";
      const complexity = def.complexity !== undefined ? ` — complexity **${def.complexity}**` : "";
      md.appendMarkdown(`**$(${icon}) ${escapeMd(def.symbol)}**${complexity}\n\n`);
      const parts = links.map((c) => `[${c.title}](${cmd(c.command, c.arguments ?? [])})`);
      if (def.kind !== "class") parts.push(`[$(list-tree) Traces](${cmd("clarifydoc.openReportForFile", [uriArg, "traces"])})`);
      md.appendMarkdown(parts.join(" · "));
    }

    const issues = facts.security.filter((s) => here(s.line));
    if (issues.length) {
      if (any) md.appendMarkdown("\n\n");
      any = true;
      for (const s of issues) {
        md.appendMarkdown(`\n\n$(shield) **${escapeMd(s.severity)}** ${escapeMd(s.category)}: ${escapeMd(s.message)}`);
      }
    }

    const routes = facts.routes.filter((r) => here(r.line));
    if (routes.length) {
      any = true;
      for (const r of routes) {
        const route = escapeMd([r.httpMethod, r.path].filter(Boolean).join(" "));
        md.appendMarkdown(`\n\n$(globe) **${route}**${r.handler ? ` → ${escapeMd(r.handler)}` : ""}`);
      }
    }

    return any ? new vscode.Hover(md, wordRange) : undefined;
  }
}
