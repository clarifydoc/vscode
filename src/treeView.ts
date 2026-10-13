import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { loadAnalysis, ResolvedAnalysis } from "./analysisData";
import { absFor } from "./reveal";

type NodeKind = "folder" | "group" | "leaf" | "action";

class Node extends vscode.TreeItem {
  children: Node[] = [];
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
    out.push(this.screensGroup(folder, a));
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

  private screensGroup(folder: vscode.WorkspaceFolder, a: ResolvedAnalysis): Node {
    const children = a.screens.map((s) => {
      const label = [s.title, s.routePath].filter(Boolean).join(" · ") || s.filePath;
      return this.revealLeaf(folder, label, s.filePath, s.line, new vscode.ThemeIcon("browser"));
    });
    return this.group("Screens", a.screens.length, "browser", children);
  }

  private securityGroup(folder: vscode.WorkspaceFolder, a: ResolvedAnalysis): Node {
    const children = a.security.map((s) => {
      const leaf = this.revealLeaf(folder, s.message, s.filePath, s.line, new vscode.ThemeIcon("shield", severityColor(s.severity)));
      leaf.tooltip = `${s.severity} · ${s.category}\n${s.filePath}:${s.line}`;
      return leaf;
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
