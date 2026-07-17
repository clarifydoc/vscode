import * as vscode from "vscode";
import * as path from "path";
import { ExtensionState } from "./state";
import { loadAnalysis, ResolvedAnalysis, SecurityIssue } from "./analysisData";

const FULL_LINE_END = 1_000_000; // Range end col; VS Code clamps to the real line length.

interface DiagSettings {
  enabled: boolean;
  complexityThreshold: number;
  include: { security: boolean; complexity: boolean; layers: boolean };
}

function diagSettings(scope: vscode.Uri): DiagSettings {
  const c = vscode.workspace.getConfiguration("clarifydoc.diagnostics", scope);
  const include = c.get<string[]>("include") ?? ["security", "complexity", "layers"];
  return {
    enabled: c.get<boolean>("enabled") ?? true,
    complexityThreshold: c.get<number>("complexityThreshold") ?? 15,
    include: {
      security: include.includes("security"),
      complexity: include.includes("complexity"),
      layers: include.includes("layers"),
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

function securityDiag(issue: SecurityIssue): vscode.Diagnostic {
  const d = new vscode.Diagnostic(lineRange(issue.line), issue.message, severityFor(issue.severity));
  d.source = "ClarifyDoc";
  d.code = issue.category;
  return d;
}

/**
 * Publishes analysis findings (security, high-complexity functions, layer
 * violations) into the Problems panel as a DiagnosticCollection. Rebuilds on
 * `onAnalysisChanged` and when the relevant settings change.
 */
export class DiagnosticsManager {
  private readonly collection: vscode.DiagnosticCollection;

  constructor(private readonly state: ExtensionState) {
    this.collection = vscode.languages.createDiagnosticCollection("clarifydoc");
    state.context.subscriptions.push(
      this.collection,
      state.onAnalysisChanged(() => void this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("clarifydoc.diagnostics")) void this.refresh();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
    );
  }

  /** Rebuild diagnostics for every workspace folder from its latest analysis. */
  async refresh(): Promise<void> {
    this.collection.clear();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const s = diagSettings(folder.uri);
      if (!s.enabled) continue;
      const analysis = await loadAnalysis(this.state.context, folder);
      if (!analysis) continue;
      this.populateFolder(folder, analysis, s);
    }
  }

  private populateFolder(folder: vscode.WorkspaceFolder, a: ResolvedAnalysis, s: DiagSettings): void {
    const byUri = new Map<string, vscode.Diagnostic[]>();
    const push = (relFile: string, d: vscode.Diagnostic) => {
      const abs = path.join(folder.uri.fsPath, relFile);
      const key = vscode.Uri.file(abs).toString();
      (byUri.get(key) ?? byUri.set(key, []).get(key)!).push(d);
    };

    if (s.include.security) {
      for (const issue of a.security) push(issue.filePath, securityDiag(issue));
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
      for (const v of a.layerViolations) {
        if (!v.filePath || v.line === undefined) continue;
        const d = new vscode.Diagnostic(
          lineRange(v.line),
          v.message ?? `Layer violation${v.from && v.to ? ` (${v.from} → ${v.to})` : ""}`,
          vscode.DiagnosticSeverity.Warning,
        );
        d.source = "ClarifyDoc";
        d.code = "layer-violation";
        push(v.filePath, d);
      }
    }

    for (const [uri, diags] of byUri) this.collection.set(vscode.Uri.parse(uri), diags);
  }
}
