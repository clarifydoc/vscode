import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { loadAnalysis, ResolvedAnalysis } from "./analysisData";
import { absFor } from "./reveal";
import { describeTable, tableUses } from "./dataTables";

type NodeKind = "folder" | "group" | "leaf" | "action";

export class Node extends vscode.TreeItem {
  children: Node[] = [];
  /** For items that stand for a place in the source: its folder and project-relative file. */
  folder?: vscode.WorkspaceFolder;
  file?: string;
  /** What "Copy" puts on the clipboard (`GET /api/orders`, a table name). */
  copyText?: string;
  constructor(
    public readonly kind: NodeKind,
    label: string,
    collapsible: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
  ) {
    super(label, collapsible);
  }
}

/** Dead files and dead exports listed in the sidebar, each. */
const DEAD_LIMIT = 50;
const HOTSPOT_LIMIT = 20;
/** Tables listed in the Data group. */
const DATA_LIMIT = 200;
/** Calls without a route, and routes without a call, listed each. */
const GAP_LIMIT = 100;

/**
 * The ClarifyDoc sidebar: per folder, a drill-down of the last analysis. Group
 * nodes expand to navigable leaves — clicking a route / screen / security issue /
 * complexity hotspot opens the source at its line. Reads resolved analysis data
 * lazily so it survives restarts with no re-scan.
 */
export class SummaryTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChange = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly state: ExtensionState) {}

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return node;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (node) return node.children;
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) return [];
    if (folders.length === 1) return this.folderChildren(folders[0]);

    const nodes: Node[] = [];
    for (const f of folders) {
      const top = new Node("folder", f.name, vscode.TreeItemCollapsibleState.Expanded);
      top.iconPath = new vscode.ThemeIcon("folder");
      top.children = await this.folderChildren(f);
      nodes.push(top);
    }
    return nodes;
  }

  private async folderChildren(folder: vscode.WorkspaceFolder): Promise<Node[]> {
    if (this.state.isRunning(folder.uri.fsPath)) {
      const running = new Node("leaf", "Analyzing…");
      running.iconPath = new vscode.ThemeIcon("loading~spin");
      return [running];
    }

    const a = await loadAnalysis(this.state.context, folder);
    if (!a) {
      const empty = new Node("action", "Analyze Workspace");
      empty.iconPath = new vscode.ThemeIcon("search-fuzzy");
      empty.description = "no analysis yet";
      empty.command = { command: "clarifydoc.analyze", title: "Analyze Workspace", arguments: [folder] };
      return [empty];
    }
    return this.groups(folder, a);
  }

  private groups(folder: vscode.WorkspaceFolder, a: ResolvedAnalysis): Node[] {
    const out: Node[] = [];

    const health = this.healthGroup(folder, a);
    if (health) out.push(health);

    out.push(this.routesGroup(folder, a));
    const gaps = this.apiGapsGroup(folder, a);
    if (gaps) out.push(gaps);
    out.push(this.screensGroup(folder, a));
    const data = this.dataGroup(folder, a);
    if (data) out.push(data);
    out.push(this.securityGroup(folder, a));
    out.push(this.hotspotsGroup(folder, a));
    const dead = this.deadCodeGroup(folder, a);
    if (dead) out.push(dead);
    out.push(this.subProjectsGroup(a));
    out.push(this.frameworksGroup(a));
    return out.filter((n): n is Node => !!n);
  }

  private revealLeaf(folder: vscode.WorkspaceFolder, label: string, file: string, line: number | undefined, icon: vscode.ThemeIcon): Node {
    const leaf = new Node("leaf", label);
    leaf.description = line ? `${file}:${line}` : file;
    leaf.tooltip = leaf.description;
    leaf.iconPath = icon;
    leaf.resourceUri = vscode.Uri.file(absFor(folder, file));
    leaf.command = {
      command: "clarifydoc.revealSource",
      title: "Open Source",
      arguments: [absFor(folder, file), line],
    };
    leaf.folder = folder;
    leaf.file = file;
    leaf.copyText = label;
    leaf.contextValue = "clarifydoc.located";
    return leaf;
  }

  private group(label: string, count: number, icon: string, children: Node[]): Node {
    const g = new Node(
      "group",
      label,
      count > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    g.description = String(count);
    g.iconPath = new vscode.ThemeIcon(icon);
    g.children = children;
    return g;
  }

  /**
   * Health drill-down: the grade, then one child per Health sub-section that has
   * data. Each child opens the report deep-linked to that section
   * (`#health/<id>`) — Score opens the Health tab itself. Returns null when
   * there is nothing health-related to show.
   */
  private healthGroup(folder: vscode.WorkspaceFolder, a: ResolvedAnalysis): Node | null {
    const grade = a.health?.grade ?? "—";
    const children: Node[] = [];
    if (a.health) {
      children.push(
        this.reportSectionLeaf(folder, "Score", `${a.health.score}/100`, "score", new vscode.ThemeIcon(gradeIcon(grade), gradeColor(grade))),
      );
    }
    for (const s of a.healthSections) {
      children.push(
        this.reportSectionLeaf(folder, s.label, String(s.count), s.id, new vscode.ThemeIcon(sectionIcon(s.id))),
      );
    }
    if (children.length === 0) return null;

    const g = new Node("group", `Health: ${grade}`, vscode.TreeItemCollapsibleState.Collapsed);
    g.description = a.health ? `${a.health.score}/100` : undefined;
    g.iconPath = new vscode.ThemeIcon(gradeIcon(grade), gradeColor(grade));
    g.children = children;
    return g;
  }

  /** A leaf that opens the report on a specific Health section. */
  private reportSectionLeaf(
    folder: vscode.WorkspaceFolder,
    label: string,
    description: string | undefined,
    section: string,
    icon: vscode.ThemeIcon,
  ): Node {
    const leaf = new Node("leaf", label);
    leaf.description = description;
    leaf.tooltip = `Open the report at Health · ${label}`;
    leaf.iconPath = icon;
    leaf.command = {
      command: "clarifydoc.openReportSection",
      title: "Open in Report",
      arguments: [folder, section],
    };
    return leaf;
  }

  private routesGroup(folder: vscode.WorkspaceFolder, a: ResolvedAnalysis): Node {
    const children = a.routes.map((r) =>
      this.revealLeaf(folder, [r.httpMethod, r.path].filter(Boolean).join(" ") || r.path, r.filePath, r.line, new vscode.ThemeIcon("milestone")),
    );
    return this.group("Routes", a.routes.length, "milestone", children);
  }

  /**
   * Where the map breaks: API calls the analysis could not join to any route
   * (with why), and routes no call in the repository reaches. A renamed
   * endpoint shows up as the client call still asking for the old path.
   */
  private apiGapsGroup(folder: vscode.WorkspaceFolder, a: ResolvedAnalysis): Node | null {
    const misses = [...a.crossTier.missesByFile.values()].flat()
      .sort((x, y) => x.file.localeCompare(y.file) || x.line - y.line);
    const uncalled = a.routes.filter((r) => a.crossTier.uncalled.has(`${r.filePath}:${r.line}`));
    if (misses.length === 0 && uncalled.length === 0) return null;

    const missLeaves = misses.slice(0, GAP_LIMIT).map((m) => {
      const leaf = this.revealLeaf(folder, [m.method, m.url].filter(Boolean).join(" "), m.file, m.line, new vscode.ThemeIcon("debug-disconnect", new vscode.ThemeColor("charts.yellow")));
      leaf.tooltip = `${missReason(m.reason)}\n${m.file}:${m.line}`;
      return leaf;
    });
    const uncalledLeaves = uncalled.slice(0, GAP_LIMIT).map((r) =>
      this.revealLeaf(folder, [r.httpMethod, r.path].filter(Boolean).join(" ") || r.path, r.filePath, r.line, new vscode.ThemeIcon("milestone")),
    );
    const uncalledTotal = Math.max(a.crossTier.uncalledCount ?? 0, uncalled.length);

    const calls = this.group("Calls that reach no route", misses.length, "debug-disconnect", missLeaves);
    calls.tooltip = "API calls in this workspace that no route serves — a renamed or removed endpoint, the wrong method, or another service's route.";
    const routes = this.group("Routes no call reaches", uncalledTotal, "milestone", uncalledLeaves);
    routes.tooltip = "Routes of services some in-repo client calls, that no call here reaches. External clients may still use them.";
    const g = this.group("API gaps", misses.length + uncalledTotal, "debug-disconnect", [calls, routes].filter((n) => n.description !== "0"));
    g.tooltip = "Where calls and routes do not meet.";
    return g;
  }

  /**
   * Each table the analysis saw accessed, with the routes and screens that
   * write or read it — the "who touches `orders`?" question, answered without
   * opening the report. A table opens its entity's declaration when known.
   */
  private dataGroup(folder: vscode.WorkspaceFolder, a: ResolvedAnalysis): Node | null {
    const tables = tableUses(a);
    if (tables.length === 0) return null;
    const children = tables.slice(0, DATA_LIMIT).map((t) => {
      const node = new Node("group", t.resource, vscode.TreeItemCollapsibleState.Collapsed);
      node.description = describeTable(t);
      node.tooltip = `${t.resource}\n${node.description}${t.entity ? `\nDeclared in ${t.entity.file}` : ""}`;
      node.iconPath = new vscode.ThemeIcon("database");
      node.contextValue = "clarifydoc.table";
      node.copyText = t.resource;
      if (t.entity) {
        node.command = { command: "clarifydoc.revealSource", title: "Open Entity", arguments: [absFor(folder, t.entity.file), t.entity.line] };
      }
      node.children = t.entries.map((e) => {
        const leaf = this.revealLeaf(folder, e.label, e.file, e.line, new vscode.ThemeIcon(e.kind === "route" ? "milestone" : "browser"));
        leaf.description = [e.writes && "writes", e.reads && "reads"].filter(Boolean).join(", ");
        leaf.tooltip = `${e.kind === "route" ? "Route" : "Screen"} ${e.label} ${leaf.description} ${t.resource}\n${e.file}${e.line ? `:${e.line}` : ""}`;
        return leaf;
      });
      return node;
    });
    return this.group("Data", tables.length, "database", children);
  }

  private screensGroup(folder: vscode.WorkspaceFolder, a: ResolvedAnalysis): Node {
    const children = a.screens.map((s) => {
      const label = [s.title, s.routePath].filter(Boolean).join(" · ") || s.filePath;
      return this.revealLeaf(folder, label, s.filePath, s.line, new vscode.ThemeIcon("browser"));
    });
    return this.group("Screens", a.screens.length, "browser", children);
  }

  /** Findings by severity, worst first — a flat list buried a critical finding under a page of low ones. */
  private securityGroup(folder: vscode.WorkspaceFolder, a: ResolvedAnalysis): Node {
    const bySeverity = new Map<string, Node[]>();
    for (const s of a.security) {
      const leaf = this.revealLeaf(folder, s.message, s.filePath, s.line, new vscode.ThemeIcon("shield", severityColor(s.severity)));
      leaf.tooltip = `${s.severity} · ${s.category}\n${s.filePath}:${s.line}`;
      leaf.copyText = `${s.message} (${s.filePath}:${s.line})`;
      const key = s.severity.toLowerCase();
      bySeverity.set(key, [...(bySeverity.get(key) ?? []), leaf]);
    }
    const levels = [...bySeverity.keys()].sort((x, y) => severityRank(x) - severityRank(y));
    const children = levels.length === 1
      ? bySeverity.get(levels[0]!)!
      : levels.map((sev) => {
          const g = this.group(sev[0]!.toUpperCase() + sev.slice(1), bySeverity.get(sev)!.length, "shield", bySeverity.get(sev)!);
          g.iconPath = new vscode.ThemeIcon("shield", severityColor(sev));
          if (severityRank(sev) <= 1) g.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
          return g;
        });
    return this.group("Security", a.security.length, "shield", children);
  }

  private hotspotsGroup(folder: vscode.WorkspaceFolder, a: ResolvedAnalysis): Node {
    const top = a.hotspots.filter((h) => h.complexity > 1).slice(0, HOTSPOT_LIMIT);
    const children = top.map((h) => {
      const leaf = this.revealLeaf(folder, `${h.functionName} (${h.complexity})`, h.filePath, h.line, new vscode.ThemeIcon("flame"));
      return leaf;
    });
    return this.group("Complexity hotspots", top.length, "flame", children);
  }

  /** Unreachable files and unused exports, plus what was not judged and why. */
  private deadCodeGroup(folder: vscode.WorkspaceFolder, a: ResolvedAnalysis): Node | null {
    const dead = a.deadCode;
    if (!dead) return null;
    const children: Node[] = [];
    for (const f of dead.files.slice(0, DEAD_LIMIT)) {
      children.push(this.revealLeaf(folder, f.filePath, f.filePath, undefined, new vscode.ThemeIcon("circle-slash")));
    }
    for (const e of dead.exports.slice(0, DEAD_LIMIT)) {
      children.push(this.revealLeaf(folder, `${e.name} (unused export)`, e.filePath, e.line, new vscode.ThemeIcon("symbol-variable")));
    }
    for (const p of dead.skippedProjects ?? []) {
      const leaf = new Node("leaf", `not judged: ${p.root || "."}`);
      leaf.description = p.reason;
      leaf.tooltip = `${p.files} files not judged — ${p.reason}`;
      leaf.iconPath = new vscode.ThemeIcon("info");
      children.push(leaf);
    }
    const g = this.group("Dead code", dead.files.length + dead.exports.length, "circle-slash", children);
    g.tooltip = `Judged from the import graph of ${dead.judgedFiles} files (${dead.languages.join(", ")}). Show these in the editor with clarifydoc.diagnostics.include → deadCode.`;
    return g;
  }

  private subProjectsGroup(a: ResolvedAnalysis): Node {
    const children = a.subProjects.map((s) => {
      const leaf = new Node("leaf", s.name || s.id || "project");
      leaf.description = s.root;
      leaf.iconPath = new vscode.ThemeIcon("project");
      return leaf;
    });
    return this.group("Sub-projects", a.subProjects.length, "project", children);
  }

  private frameworksGroup(a: ResolvedAnalysis): Node {
    const children = a.frameworks.map((fw) => {
      const leaf = new Node("leaf", fw.name);
      leaf.description = fw.confidence;
      leaf.tooltip = fw.detectedVia;
      leaf.iconPath = new vscode.ThemeIcon("layers");
      return leaf;
    });
    return this.group("Frameworks", a.frameworks.length, "layers", children);
  }
}

/** Why the route linker joined a call to nothing, in words. */
export function missReason(reason: string): string {
  switch (reason) {
    case "unmatched": return "No route serves this path.";
    case "method-mismatch": return "A route serves this path, but for another method.";
    case "origin-mismatch": return "The service this call goes to serves no such route.";
    case "ambiguous-suffix": return "Several routes end this way; none is the one.";
    default: return reason;
  }
}

function gradeIcon(grade: string): string {
  const g = grade.toUpperCase()[0];
  if (g === "A" || g === "B") return "pass-filled";
  if (g === "C") return "info";
  return "error";
}
function gradeColor(grade: string): vscode.ThemeColor {
  const g = grade.toUpperCase()[0];
  if (g === "A" || g === "B") return new vscode.ThemeColor("charts.green");
  if (g === "C") return new vscode.ThemeColor("charts.yellow");
  return new vscode.ThemeColor("charts.red");
}
/** critical → 0 … info → 4; anything else last. */
function severityRank(sev: string): number {
  const i = ["critical", "high", "medium", "low", "info"].indexOf(sev.toLowerCase());
  return i < 0 ? 5 : i;
}
function severityColor(sev: string): vscode.ThemeColor {
  const s = sev.toLowerCase();
  if (s === "critical" || s === "high") return new vscode.ThemeColor("charts.red");
  if (s === "medium") return new vscode.ThemeColor("charts.yellow");
  return new vscode.ThemeColor("charts.blue");
}
/** Codicon id for a Health sub-section leaf. */
function sectionIcon(section: string): string {
  switch (section) {
    case "patterns": return "symbol-structure";
    case "security": return "shield";
    case "suggestions": return "lightbulb";
    case "duplicates": return "copy";
    case "layers": return "layers";
    default: return "pulse";
  }
}

/** Report tabs a sidebar item can open on its file. */
export type ItemReportTab = "blast" | "traces";

/** The report location for a sidebar item: its tab, focused on its file. */
export function itemReportHash(node: Node, tab: ItemReportTab): string | undefined {
  return node.file ? `${tab}~${encodeURIComponent(node.file)}` : undefined;
}
