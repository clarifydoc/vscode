import * as os from "os";
import * as vscode from "vscode";
import { loadAnalysis, loadAnalyzer, loadSummary } from "./analysisData";
import { getConfig } from "./config";
import { issueReport, languageCounts, type IssueFolder, type IssueKind } from "./issueReport";
import { storageFor } from "./paths";
import { ExtensionState } from "./state";
import { thinMapNotes } from "./thinMap";

const KINDS: Array<vscode.QuickPickItem & { issue: IssueKind }> = [
  { issue: "bug", label: "$(bug) Something went wrong", description: "an error, a crash, a view that does not work" },
  { issue: "gap", label: "$(search) The analysis missed something", description: "a route, screen, call or table it should have found" },
  { issue: "idea", label: "$(lightbulb) An idea", description: "something you would like it to do" },
];

/**
 * "ClarifyDoc: Report an Issue" (VSCODE 8.4). The issue opens prefilled in
 * the browser — versions, OS, settings that change behaviour, and per folder
 * what the analysis found and could not see — for the user to read, edit and
 * submit there. Nothing is sent from the editor.
 */
export async function reportIssue(
  state: ExtensionState,
  preset?: { kind?: IssueKind; folder?: vscode.WorkspaceFolder; summary?: string },
): Promise<void> {
  const kind = preset?.kind ?? (await vscode.window.showQuickPick(KINDS, { placeHolder: "What would you like to report?" }))?.issue;
  if (!kind) return;
  const { context } = state;

  const folders = preset?.folder ? [preset.folder] : [...(vscode.workspace.workspaceFolders ?? [])];
  const described: IssueFolder[] = [];
  for (const f of folders) {
    const a = await loadAnalysis(context, f);
    if (!a) {
      described.push({});
      continue;
    }
    const s = await loadSummary(context, f);
    const unplaced: Record<string, number> = {};
    for (const m of [...a.crossTier.missesByFile.values()].flat()) unplaced[m.reason] = (unplaced[m.reason] ?? 0) + 1;
    const thin = [...a.thinFiles.values()];
    described.push({
      analysis: {
        analyzedAt: s?.analyzedAt,
        files: a.files.size,
        languages: languageCounts(a.files),
        frameworks: a.frameworks.map((x) => x.name),
        subProjects: a.subProjects.length,
        routes: a.routes.length,
        screens: a.screens.length,
        apiCalls: s?.counts.apiCalls ?? 0,
        unplaced,
        thin: { parse: thin.filter((t) => t.parseRatio).length, imports: thin.filter((t) => t.unresolvedImports).length },
        notes: thinMapNotes({ files: a.files.size, routes: a.routes.length, screens: a.screens.length, packages: a.packages }),
      },
    });
  }

  const cfg = getConfig(folders[0]?.uri);
  const analyzer = await loadAnalyzer(context);
  const { title, body, url } = issueReport(
    {
      kind,
      extension: String(context.extension.packageJSON.version ?? "?"),
      analyzer: analyzer?.TOOL_VERSION,
      editor: `${vscode.env.appName} ${vscode.version}`,
      os: `${process.platform} ${os.release()} ${process.arch}`,
      remote: vscode.env.remoteName,
      settings: {
        storage: folders[0] ? storageFor(folders[0]).mode : cfg.storage,
        editorLsp: cfg.editorLsp,
        dockerLsp: cfg.enableLsp,
        analyzeOnSave: cfg.analyzeOnSave,
        incremental: cfg.incremental,
        customCli: cfg.cliPath !== "",
      },
      folders: described,
    },
    preset?.summary ?? "",
  );

  const choice = await vscode.window.showInformationMessage(
    "ClarifyDoc: the issue opens on GitHub, prefilled with versions, settings and counts from the analysis — no file, folder or route names. Nothing is sent until you submit it there.",
    "Open on GitHub",
    "Copy Text",
  );
  if (choice === "Open on GitHub") await vscode.env.openExternal(vscode.Uri.parse(url));
  if (choice === "Copy Text") {
    await vscode.env.clipboard.writeText(`${title}\n\n${body}`);
    vscode.window.setStatusBarMessage("ClarifyDoc: issue text copied", 3000);
  }
  state.output.info(`[report issue] ${kind}, ${body.length} chars over ${described.length} folder(s): ${choice ?? "dismissed"}`);
}
