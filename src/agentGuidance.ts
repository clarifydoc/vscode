import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { ExtensionState } from "./state";
import { loadAnalyzer } from "./analysisData";
import { COPILOT_INSTRUCTIONS_HEADER, CURSOR_RULE_HEADER, START, mergeGuidance } from "./guidanceMerge";
import { pickWorkspaceFolder } from "./workspace";
import { notesFiles, readNotes } from "./notesHost";
import { notesGuidance } from "./notes";

const SCHEME = "clarifydoc-proposed";
const proposals = new Map<string, string>();

/** Serves the proposed file text to the diff editor. */
export function registerProposalProvider(state: ExtensionState): void {
  state.context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
      provideTextDocumentContent: (uri) => proposals.get(uri.toString()) ?? "",
    }),
  );
}

async function read(file: string): Promise<string | undefined> {
  return fs.readFile(file, "utf8").catch(() => undefined);
}

const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory(), () => false);

/**
 * Where an agent looks for project instructions: an existing AGENTS.md, then
 * CLAUDE.md; else, when the project instructs Copilot, a file of our own in
 * .github/instructions/ (its shared copilot-instructions.md is left alone,
 * unless an earlier run already put our section there); else a Cursor rule
 * when the project uses Cursor; else a new AGENTS.md (read by Codex, Copilot,
 * Cursor and others).
 */
async function targetFile(folder: vscode.WorkspaceFolder): Promise<{ file: string; header: string }> {
  const root = folder.uri.fsPath;
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const file = path.join(root, name);
    if ((await read(file)) !== undefined) return { file, header: "" };
  }
  const github = path.join(root, ".github");
  const copilotShared = await read(path.join(github, "copilot-instructions.md"));
  if (copilotShared?.includes(START)) return { file: path.join(github, "copilot-instructions.md"), header: "" };
  if (copilotShared !== undefined || (await isDir(path.join(github, "instructions")))) {
    return { file: path.join(github, "instructions", "clarifydoc.instructions.md"), header: COPILOT_INSTRUCTIONS_HEADER };
  }
  const cursor = path.join(root, ".cursor");
  if (await isDir(cursor)) return { file: path.join(cursor, "rules", "clarifydoc.mdc"), header: CURSOR_RULE_HEADER };
  return { file: path.join(root, "AGENTS.md"), header: "" };
}

/**
 * Tell the project's agents when to use ClarifyDoc: add (or update) a marked
 * section in AGENTS.md / CLAUDE.md / a Copilot instructions file / a Cursor rule, after showing the change
 * as a diff and asking. Nothing is written without that confirmation.
 */
export async function installAgentGuidance(state: ExtensionState, target?: vscode.WorkspaceFolder | vscode.Uri): Promise<void> {
  const folder = await pickWorkspaceFolder(target);
  if (!folder) return;
  const guidance = (await loadAnalyzer(state.context))?.AGENT_GUIDANCE;
  if (!guidance) {
    void vscode.window.showErrorMessage("ClarifyDoc: the bundled analyzer has no agent guidance. Update the extension.");
    return;
  }
  const { file, header } = await targetFile(folder);
  const before = await read(file);
  // The notes people left in the report, pointed at and summarized — refreshed each time this runs.
  const md = notesFiles(state.context, folder).md;
  const inTree = !path.relative(folder.uri.fsPath, md).startsWith("..");
  const notes = notesGuidance(await readNotes(state.context, folder), inTree ? path.relative(folder.uri.fsPath, md).split(path.sep).join("/") : md);
  const after = mergeGuidance(before, guidance + notes, header);
  const rel = path.relative(folder.uri.fsPath, file).split(path.sep).join("/");
  if (before === after) {
    void vscode.window.showInformationMessage(`ClarifyDoc: ${rel} already has the current guidance.`);
    return;
  }

  const proposed = vscode.Uri.parse(`${SCHEME}:/${encodeURIComponent(rel)}?${Date.now()}`);
  proposals.set(proposed.toString(), after);
  const left = before === undefined ? proposed.with({ query: "empty" }) : vscode.Uri.file(file);
  if (before === undefined) proposals.set(left.toString(), "");
  await vscode.commands.executeCommand("vscode.diff", left, proposed, `${rel} — ClarifyDoc guidance (proposed)`, { preview: true });

  const choice = await vscode.window.showInformationMessage(
    `${before === undefined ? "Create" : "Update"} ${rel} with the ClarifyDoc section shown in the diff?`,
    { modal: true, detail: "It tells AI agents when to use the ClarifyDoc MCP tools instead of searching text. The section sits between clarifydoc:start/end markers, so running this again updates it in place." },
    before === undefined ? "Create" : "Update",
  );
  proposals.delete(proposed.toString());
  proposals.delete(left.toString());
  if (!choice) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, after, "utf8");
  state.output.info(`[mcp] wrote the ClarifyDoc guidance section to ${file}`);
  await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
}
