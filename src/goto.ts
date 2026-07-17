import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { loadAnalysis, ResolvedAnalysis } from "./analysisData";
import { pickWorkspaceFolder } from "./workspace";
import { openSourceAt, absFor } from "./reveal";

interface Target extends vscode.QuickPickItem {
  file: string;
  line?: number;
}

function itemsFor(a: ResolvedAnalysis, kind: string): Target[] {
  switch (kind) {
    case "routes":
      return a.routes.map((r) => ({
        label: [r.httpMethod, r.path].filter(Boolean).join(" ") || r.path,
        description: `${r.filePath}:${r.line}`,
        detail: r.handler ? `→ ${r.handler}` : undefined,
        file: r.filePath,
        line: r.line,
      }));
    case "screens":
      return a.screens.map((s) => ({
        label: s.title || s.filePath,
        description: s.line ? `${s.filePath}:${s.line}` : s.filePath,
        file: s.filePath,
        line: s.line,
      }));
    case "security":
      return a.security.map((s) => ({
        label: s.message,
        description: `${s.filePath}:${s.line}`,
        detail: `${s.severity} · ${s.category}`,
        file: s.filePath,
        line: s.line,
      }));
    case "hotspots":
      return a.hotspots
        .filter((h) => h.complexity > 1)
        .map((h) => ({
          label: `${h.functionName} (${h.complexity})`,
          description: `${h.filePath}:${h.line}`,
          file: h.filePath,
          line: h.line,
        }));
    default:
      return [];
  }
}

/**
 * "ClarifyDoc: Go to…" — a two-step quick-pick (category → item) over the latest
 * analysis. Jumps the editor to the chosen route / screen / security issue /
 * complexity hotspot.
 */
export async function gotoQuickPick(state: ExtensionState): Promise<void> {
  const folder = await pickWorkspaceFolder();
  if (!folder) return;
  const a = await loadAnalysis(state.context, folder);
  if (!a) {
    const choice = await vscode.window.showWarningMessage(
      `ClarifyDoc: analyze ${folder.name} first.`,
      "Analyze Workspace",
    );
    if (choice === "Analyze Workspace") await vscode.commands.executeCommand("clarifydoc.analyze", folder);
    return;
  }

  const categories = [
    { label: "$(milestone) Routes", cat: "routes", count: a.routes.length },
    { label: "$(browser) Screens", cat: "screens", count: a.screens.length },
    { label: "$(shield) Security issues", cat: "security", count: a.security.length },
    { label: "$(flame) Complexity hotspots", cat: "hotspots", count: a.hotspots.filter((h) => h.complexity > 1).length },
  ]
    .filter((c) => c.count > 0)
    .map((c) => ({ ...c, description: String(c.count) }));

  if (categories.length === 0) {
    void vscode.window.showInformationMessage("ClarifyDoc: nothing to navigate to in this analysis.");
    return;
  }

  const chosen = await vscode.window.showQuickPick(categories, { placeHolder: "Go to…" });
  if (!chosen) return;

  const items = itemsFor(a, chosen.cat);
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: chosen.label.replace(/\$\([^)]+\)\s*/, ""),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (pick) await openSourceAt(absFor(folder, pick.file), pick.line);
}
