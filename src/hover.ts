import * as vscode from "vscode";
import * as path from "path";
import { ExtensionState } from "./state";
import { ApiRouteLink, loadFileIndex, linkCommands } from "./analysisData";
import { escapeMd } from "./markdown";
import { absFor } from "./reveal";
import { DocFacts, crossTierEnabled, docFacts } from "./docFacts";
import { callersOf, describeRoute, isUncalled, linksAtLine, missesAtLine, routeData, screensReaching } from "./crossTier";

/** The only commands the card's links may run. Everything else in it is text. */
const HOVER_COMMANDS = [
  "clarifydoc.showCallers",
  "clarifydoc.showCallees",
  "clarifydoc.openReportForFile",
  "clarifydoc.revealSource",
];

function enabled(scope: vscode.Uri): boolean {
  return vscode.workspace.getConfiguration("clarifydoc.hover", scope).get<boolean>("enabled") ?? true;
}

function cmd(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}

/** A link that opens a project file at a line; `label` defaults to `file.ts:42`. */
function sourceLink(d: DocFacts, file: string, line?: number, label?: string): string {
  const text = label ?? `${path.posix.basename(file)}${line ? `:${line}` : ""}`;
  return `[${escapeMd(text)}](${cmd("clarifydoc.revealSource", [absFor(d.folder, file), line])})`;
}

/** How sure a link is, and how it was made, in a few words. */
function provenance(l: ApiRouteLink): string {
  return escapeMd(`${l.confidence.toLowerCase()}${l.matchedVia ? ` via ${l.matchedVia}` : ""}`);
}

function routeLabel(r: { httpMethod?: string; path: string }): string {
  return escapeMd([r.httpMethod, r.path].filter(Boolean).join(" "));
}

/** Caller links listed in a card before "and N more". */
const CARD_CALLERS = 5;

/**
 * On hover, show a compact ClarifyDoc card for the code under the cursor:
 * complexity (where measured), caller/callee or reference counts, any security
 * finding on this line — and across tiers: the route an API call reaches (or
 * why it reaches none), and for a route, who calls it, from which screens, and
 * what it reads and writes, with the path the analyzer traced to the data.
 */
export class ClarifyDocHoverProvider implements vscode.HoverProvider {
  constructor(private readonly state: ExtensionState) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    if (!enabled(document.uri)) return undefined;
    const d = await docFacts(this.state, document);
    if (!d) return undefined;

    const wordRange = document.getWordRangeAtPosition(position);
    const word = wordRange ? document.getText(wordRange) : "";
    // Analysis lines (1-based) are compared where they are now, so the card
    // still matches after edits made since the analysis.
    const here = (line1: number) => d.isAt(line1, position.line);
    const sections: string[] = [];

    const idx = await loadFileIndex(this.state.context, d.folder, d.rel, d.facts);
    const def = idx.defs.find((x) => x.symbol === word) ?? idx.defs.find((x) => here(x.line));
    const uriArg = document.uri.toString();
    const links = def ? linkCommands(idx, def, uriArg) : [];
    // A class card is only its references, so it shows when there are some.
    if (def && (def.kind !== "class" || links.length > 0)) {
      const icon = def.kind === "class" ? "symbol-class" : "symbol-method";
      const complexity = def.complexity !== undefined ? ` — complexity **${def.complexity}**` : "";
      const parts = links.map((c) => `[${c.title}](${cmd(c.command, c.arguments ?? [])})`);
      if (def.kind !== "class") parts.push(`[$(list-tree) Traces](${cmd("clarifydoc.openReportForFile", [uriArg, "traces"])})`);
      sections.push(`**$(${icon}) ${escapeMd(def.symbol)}**${complexity}\n\n${parts.join(" · ")}`);
    }

    for (const s of d.facts.security.filter((x) => here(x.line))) {
      sections.push(`$(shield) **${escapeMd(s.severity)}** ${escapeMd(s.category)}: ${escapeMd(s.message)}`);
    }

    if (crossTierEnabled(document.uri)) {
      sections.push(...callSections(d, here), ...routeSections(d, here));
    } else {
      for (const r of d.facts.routes.filter((x) => here(x.line))) {
        sections.push(`$(globe) **${routeLabel(r)}**${r.handler ? ` → ${escapeMd(r.handler)}` : ""}`);
      }
    }

    if (sections.length === 0) return undefined;
    const md = new vscode.MarkdownString(sections.join("\n\n---\n\n"));
    md.isTrusted = { enabledCommands: HOVER_COMMANDS };
    md.supportThemeIcons = true;
    return new vscode.Hover(md, wordRange);
  }
}

/** An API call on this line: the route it reaches, or why it reaches none. */
function callSections(d: DocFacts, here: (line1: number) => boolean): string[] {
  const out: string[] = [];
  const lines = new Set([...d.facts.apiCalls.map((c) => c.line), ...d.facts.callsRoutes.map((l) => l.sourceLine)]);
  for (const line of [...lines].filter(here)) {
    for (const l of linksAtLine(d.facts, line)) {
      const project = l.targetProject && l.targetProject !== l.sourceProject ? ` in **${escapeMd(l.targetProject)}**` : "";
      const handler = l.handler ? ` · ${escapeMd(l.handler)}` : "";
      const ambiguous = l.confidence === "AMBIGUOUS" ? " — the first of several routes it could mean" : "";
      out.push(
        `$(arrow-right) **${escapeMd([l.method, l.routePath].filter(Boolean).join(" "))}**${project} · ` +
          `${sourceLink(d, l.target, l.targetLine)}${handler} · _${provenance(l)}_${ambiguous}`,
      );
    }
    for (const m of missesAtLine(d.analysis.crossTier, d.rel, line)) {
      out.push(`$(circle-slash) **${escapeMd(m.url)}** — no route found _(${escapeMd(m.reason)})_`);
    }
  }
  return out;
}

/** A route declared on this line: callers, screens, data, and the path to it. */
function routeSections(d: DocFacts, here: (line1: number) => boolean): string[] {
  const out: string[] = [];
  for (const r of d.facts.routes.filter((x) => here(x.line))) {
    const callers = callersOf(d.facts, r);
    const screens = screensReaching(d.analysis.crossTier, callers);
    const data = routeData(d.analysis.crossTier, r);
    const parts = [`$(globe) **${routeLabel(r)}**${r.handler ? ` → ${escapeMd(r.handler)}` : ""}`];
    const summary = describeRoute(callers.length, screens, data, isUncalled(d.analysis.crossTier, r));
    if (summary) parts.push(escapeMd(summary));
    if (screens.length) parts.push(`Screens: ${screens.map((s) => sourceLink(d, s.filePath, undefined, s.title)).join(", ")}`);
    if (callers.length) {
      const shown = callers.slice(0, CARD_CALLERS).map((l) => sourceLink(d, l.source, l.sourceLine));
      const more = callers.length - shown.length;
      parts.push(`Called from ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`);
    }
    // The shortest path to the data, hop by hop, as the analyzer traced it.
    const flow = data.flows.find((f) => (f.via?.length ?? 0) > 1);
    if (flow?.via) {
      const hops = flow.via
        .filter((h) => !h.symbol.startsWith("route:"))
        .map((h) => sourceLink(d, h.file, h.line, h.symbol));
      parts.push(`${hops.join(" → ")} → **${escapeMd(flow.resource)}** _${escapeMd(flow.effect)}_`);
    }
    out.push(parts.join("\n\n"));
  }
  return out;
}
