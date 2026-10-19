import * as vscode from "vscode";
import * as path from "path";
import { ExtensionState } from "./state";
import { DeadCode, LayerViolation, loadAnalysis, ResolvedAnalysis, SecurityIssue } from "./analysisData";
import type { CallMiss } from "./crossTier";

const FULL_LINE_END = 1_000_000; // Range end col; VS Code clamps to the real line length.

interface DiagSettings {
  enabled: boolean;
  complexityThreshold: number;
  include: { security: boolean; complexity: boolean; layers: boolean; deadCode: boolean; routeGaps: boolean };
}

function diagSettings(scope: vscode.Uri): DiagSettings {
  const c = vscode.workspace.getConfiguration("clarifydoc.diagnostics", scope);
  const include = c.get<string[]>("include") ?? ["security", "complexity", "layers", "routeGaps"];
  return {
    enabled: c.get<boolean>("enabled") ?? true,
    complexityThreshold: c.get<number>("complexityThreshold") ?? 15,
    include: {
      security: include.includes("security"),
      complexity: include.includes("complexity"),
      layers: include.includes("layers"),
      deadCode: include.includes("deadCode"),
      routeGaps: include.includes("routeGaps"),
    },
  };
}

function severityFor(sev: string): vscode.DiagnosticSeverity {
  switch (sev.toLowerCase()) {
    case "critical":
    case "high":
      return vscode.DiagnosticSeverity.Error;
    case "medium":
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

function lineRange(line1Based: number): vscode.Range {
  const l = Math.max(0, line1Based - 1); // analyzer lines are 1-based
  return new vscode.Range(l, 0, l, FULL_LINE_END);
}

/** The same finding at another line (the file was edited since the analysis). */
function movedTo(d: vscode.Diagnostic, line: number): vscode.Diagnostic {
  const out = new vscode.Diagnostic(new vscode.Range(line, 0, line, FULL_LINE_END), d.message, d.severity);
  out.source = d.source;
  out.code = d.code;
  out.tags = d.tags;
  out.relatedInformation = d.relatedInformation;
  return out;
}

/** The page describing a CWE, for the diagnostic's code link. */
function cweUri(cwe: string): vscode.Uri | undefined {
  const n = /^CWE-(\d+)$/.exec(cwe)?.[1];
  return n ? vscode.Uri.parse(`https://cwe.mitre.org/data/definitions/${n}.html`) : undefined;
}

function securityDiag(issue: SecurityIssue, folder: vscode.WorkspaceFolder, a: ResolvedAnalysis): vscode.Diagnostic {
  const target = issue.cwe ? cweUri(issue.cwe) : undefined;
  // With a CWE as the code, the category moves into the message.
  const message = target ? `${issue.category}: ${issue.message}` : issue.message;
  const d = new vscode.Diagnostic(lineRange(issue.line), message, severityFor(issue.severity));
  d.source = "ClarifyDoc";
  d.code = target ? { value: issue.cwe!, target } : issue.category;
  // The routes whose handlers reach this line: what an attacker would call.
  if (issue.entries?.length) {
    d.relatedInformation = issue.entries.map((e) => {
      const route = a.routes.find((r) => r.filePath === e.file && [r.httpMethod, r.path].filter(Boolean).join(" ") === e.route);
      const hops = `${e.distance} call${e.distance === 1 ? "" : "s"} away, ${e.confidence.toLowerCase()}`;
      return new vscode.DiagnosticRelatedInformation(
        new vscode.Location(vscode.Uri.file(path.join(folder.uri.fsPath, e.file)), lineRange(route?.line ?? 1)),
        `reached from ${e.route} (${hops})`,
      );
    });
  }
  return d;
}

const MISS_TEXT: Record<string, string> = {
  unmatched: "reaches no route in this analysis",
  "method-mismatch": "asks for a method the route does not serve",
  "origin-mismatch": "goes to a service that has no such route",
  "ambiguous-suffix": "ends like several routes, so none was chosen",
};

/**
 * A call that reached no route, at the call. A refused method or service is
 * a warning — the client asks for what the server does not serve; a path no
 * route has is information, since it may be another system's API. The
 * routes that do serve the path are related locations, and the quick fix
 * opens them.
 */
export function routeMissDiag(m: CallMiss, folder: vscode.WorkspaceFolder): vscode.Diagnostic {
  const call = `${m.method ? m.method + " " : ""}${m.url}`;
  const served = m.existing?.length ? `; the backend serves ${m.existing.map((r) => `${r.method ?? "*"} ${r.path}`).join(", ")}` : "";
  const severity = m.reason === "method-mismatch" || m.reason === "origin-mismatch"
    ? vscode.DiagnosticSeverity.Warning
    : vscode.DiagnosticSeverity.Information;
  const d = new vscode.Diagnostic(lineRange(m.line), `${call} ${MISS_TEXT[m.reason] ?? "reaches no route"}${served}`, severity);
  d.source = "ClarifyDoc";
  d.code = "route-miss";
  if (m.existing?.length) {
    d.relatedInformation = m.existing.map((r) => new vscode.DiagnosticRelatedInformation(
      new vscode.Location(vscode.Uri.file(path.join(folder.uri.fsPath, r.file)), lineRange(r.line)),
      `${r.method ?? "*"} ${r.path}`,
    ));
  }
  return d;
}

function layerDiag(v: LayerViolation): vscode.Diagnostic {
  const what = v.importSpecifier ? `imports ${v.importSpecifier}` : "Layer violation";
  const layers = v.sourceLayer && v.targetLayer ? ` (${v.sourceLayer} → ${v.targetLayer})` : "";
  const rule = v.rule ? ` — breaks rule "${v.rule}"` : "";
  // A team rule says how much it matters; the built-in layer order is a warning.
  const severity = v.rule && v.severity === "warn" ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Warning;
  const d = new vscode.Diagnostic(lineRange(v.line), `${what}${layers}${rule}`, severity);
  d.source = "ClarifyDoc";
  d.code = "layer-violation";
  return d;
}

/**
 * Dead code as faded text: an unused export at its line, an unreachable file
 * over its whole length. Hints, so they never count as problems. Every one is
 * an accusation the analyzer makes from its import graph, so the message says
 * what was judged.
 */
function deadCodeDiags(dead: DeadCode): { file: string; diag: vscode.Diagnostic }[] {
  const judged = `judged from the import graph of ${dead.judgedFiles} ${dead.languages.join("/")} files`;
  const out: { file: string; diag: vscode.Diagnostic }[] = [];
  for (const e of dead.exports) {
    const also = e.usedInFile ? "; it is used in this file, so only the export is unused" : "";
    const diag = new vscode.Diagnostic(
      lineRange(e.line),
      `${e.name} is exported, but nothing imports it${also} (${judged})`,
      vscode.DiagnosticSeverity.Hint,
    );
    diag.source = "ClarifyDoc";
    diag.code = "dead-code";
    diag.tags = [vscode.DiagnosticTag.Unnecessary];
    out.push({ file: e.filePath, diag });
  }
  for (const f of dead.files) {
    const lines = Math.max(1, f.lineCount ?? 1);
    const importers = f.deadImporters ? `; only unreachable files import it (${f.deadImporters})` : "";
    const diag = new vscode.Diagnostic(
      new vscode.Range(0, 0, lines - 1, FULL_LINE_END),
      `No entry point reaches this file${importers} (${judged})`,
      vscode.DiagnosticSeverity.Hint,
    );
    diag.source = "ClarifyDoc";
    diag.code = "dead-code";
    diag.tags = [vscode.DiagnosticTag.Unnecessary];
    out.push({ file: f.filePath, diag });
  }
  return out;
}

/**
 * Publishes analysis findings (security, high-complexity functions, layer
 * violations) into the Problems panel as a DiagnosticCollection. Rebuilds on
 * `onAnalysisChanged` and when the relevant settings change.
 */
export class DiagnosticsManager {
  private readonly collection: vscode.DiagnosticCollection;
  /** Bumped by every refresh; a refresh that finds it moved on drops its result. */
  private generation = 0;
  /** Each file's findings at the lines the analysis gave them. */
  private base = new Map<string, vscode.Diagnostic[]>();

  constructor(private readonly state: ExtensionState) {
    this.collection = vscode.languages.createDiagnosticCollection("clarifydoc");
    state.context.subscriptions.push(
      this.collection,
      state.onAnalysisChanged(() => void this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("clarifydoc.diagnostics")) void this.refresh();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
      state.lines.onDidChange((uri) => {
        if (this.base.has(uri.toString())) this.publish(uri.toString());
      }),
    );
  }

  /** Show a file's findings where its lines are now. */
  private publish(key: string): void {
    const uri = vscode.Uri.parse(key);
    const diags = this.base.get(key) ?? [];
    if (!this.state.lines.isEdited(uri)) {
      this.collection.set(uri, diags);
      return;
    }
    const moved: vscode.Diagnostic[] = [];
    for (const d of diags) {
      const line = this.state.lines.map(uri, d.range.start.line);
      if (line !== undefined) moved.push(line === d.range.start.line ? d : movedTo(d, line));
    }
    this.collection.set(uri, moved);
  }

  /**
   * Rebuild diagnostics for every workspace folder from its latest analysis.
   * The whole set is built first and swapped in at once, so the Problems panel
   * never shows a half-cleared state, and a refresh overtaken by a newer one
   * (two analyses finishing close together) is dropped instead of
   * interleaving with it.
   */
  async refresh(): Promise<void> {
    const generation = ++this.generation;
    const byUri = new Map<string, vscode.Diagnostic[]>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const s = diagSettings(folder.uri);
      if (!s.enabled) continue;
      const analysis = await loadAnalysis(this.state.context, folder);
      if (generation !== this.generation) return;
      if (!analysis) continue;
      this.populateFolder(folder, analysis, s, byUri);
    }
    this.base = byUri;
    this.collection.clear();
    for (const key of byUri.keys()) this.publish(key);
  }

  private populateFolder(
    folder: vscode.WorkspaceFolder,
    a: ResolvedAnalysis,
    s: DiagSettings,
    byUri: Map<string, vscode.Diagnostic[]>,
  ): void {
    const push = (relFile: string, d: vscode.Diagnostic) => {
      const abs = path.join(folder.uri.fsPath, relFile);
      const key = vscode.Uri.file(abs).toString();
      (byUri.get(key) ?? byUri.set(key, []).get(key)!).push(d);
    };

    if (s.include.security) {
      for (const issue of a.security) push(issue.filePath, securityDiag(issue, folder, a));
    }
    if (s.include.complexity) {
      for (const h of a.hotspots) {
        if (h.complexity < s.complexityThreshold) continue;
        const d = new vscode.Diagnostic(
          lineRange(h.line),
          `${h.functionName}: cyclomatic complexity ${h.complexity} (threshold ${s.complexityThreshold})`,
          h.complexity >= s.complexityThreshold * 2
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information,
        );
        d.source = "ClarifyDoc";
        d.code = "complexity";
        push(h.filePath, d);
      }
    }
    if (s.include.layers) {
      for (const v of a.layerViolations) push(v.sourceFile, layerDiag(v));
    }
    if (s.include.deadCode && a.deadCode) {
      for (const d of deadCodeDiags(a.deadCode)) push(d.file, d.diag);
    }
    if (s.include.routeGaps) {
      for (const misses of a.crossTier.missesByFile.values()) {
        for (const m of misses) push(m.file, routeMissDiag(m, folder));
      }
    }
  }
}
