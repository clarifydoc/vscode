import * as vscode from "vscode";

/**
 * Typed accessors over the `clarifydoc.*` configuration. Everything is read
 * fresh from `workspace.getConfiguration` so live edits in Settings take effect
 * without a reload; the `scope` argument lets per-folder settings win.
 */
export interface ClarifyDocConfig {
  cliPath: string;
  nodePath: string;
  incremental: boolean;
  enableLsp: boolean;
  lspTimeout: number;
  gitHistory: boolean;
  maxFiles: number;
  includeGlobs: string[];
  excludeGlobs: string[];
  openReportAfterAnalyze: boolean;
  reportLocation: "editor" | "browser";
  analyzeOnSave: boolean;
}

export function getConfig(scope?: vscode.Uri): ClarifyDocConfig {
  const c = vscode.workspace.getConfiguration("clarifydoc", scope ?? null);
  return {
    cliPath: (c.get<string>("cliPath") ?? "").trim(),
    nodePath: (c.get<string>("nodePath") ?? "").trim(),
    incremental: c.get<boolean>("incremental") ?? true,
    enableLsp: c.get<boolean>("enableLsp") ?? false,
    lspTimeout: c.get<number>("lspTimeout") ?? 0,
    gitHistory: c.get<boolean>("gitHistory") ?? true,
    maxFiles: c.get<number>("maxFiles") ?? 0,
    includeGlobs: c.get<string[]>("includeGlobs") ?? [],
    excludeGlobs: c.get<string[]>("excludeGlobs") ?? [],
    openReportAfterAnalyze: c.get<boolean>("openReportAfterAnalyze") ?? true,
    reportLocation: c.get<"editor" | "browser">("reportLocation") ?? "editor",
    analyzeOnSave: c.get<boolean>("analyzeOnSave") ?? false,
  };
}
