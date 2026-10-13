import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { ExtensionState } from "./state";
import { relativeInside } from "./pathUtil";

/**
 * The ignore file this command writes: `.clarifydocignore` at the workspace
 * folder's root. The analyzer also reads `.clarifydoc/ignore`, but that
 * directory hides itself from git, and a folder left out of the analysis is a
 * decision the team and the CLI should share.
 */
const IGNORE_FILE = ".clarifydocignore";

/**
 * The line that ignores one folder: anchored at the root (`/a/b/`), so a
 * folder of the same name elsewhere stays in. The analyzer's matcher has no
 * escapes, so a glob character in a name is matched as any one character.
 */
export function ignoreLineFor(rel: string): string {
  return `/${rel.replace(/[[\]*?]/g, "?")}/`;
}

/**
 * Explorer → "Ignore Folder in ClarifyDoc": add each selected folder to its
 * workspace folder's `.clarifydocignore`. The analyzer then never enters it —
 * the walk is pruned, not just filtered — so it is also how a tree of
 * generated files, clones or stored data stops slowing every run.
 */
export async function ignoreFolders(
  state: ExtensionState,
  clicked?: vscode.Uri,
  selected?: vscode.Uri[],
): Promise<void> {
  const uris = selected?.length ? selected : clicked ? [clicked] : [];
  if (uris.length === 0) {
    void vscode.window.showInformationMessage("ClarifyDoc: right-click a folder in the Explorer to ignore it.");
    return;
  }

  const byFolder = new Map<vscode.WorkspaceFolder, string[]>();
  for (const uri of uris) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const rel = folder && relativeInside(folder.uri.fsPath, uri.fsPath);
    if (!folder || !rel) {
      void vscode.window.showWarningMessage(
        `ClarifyDoc: ${path.basename(uri.fsPath)} is a workspace folder itself, or outside one — only a folder inside a workspace can be ignored.`,
      );
      continue;
    }
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), rel]);
  }

  for (const [folder, rels] of byFolder) {
    const file = path.join(folder.uri.fsPath, IGNORE_FILE);
    let existing = "";
    try {
      existing = await fs.readFile(file, "utf8");
    } catch {
      existing = "";
    }
    const present = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
    const added = [...new Set(rels.map(ignoreLineFor))].filter((line) => !present.has(line));
    if (added.length === 0) {
      void vscode.window.showInformationMessage(`ClarifyDoc already ignores ${rels.join(", ")}.`);
      continue;
    }

    const sep = existing === "" || existing.endsWith("\n") ? "" : "\n";
    await fs.writeFile(file, `${existing}${sep}${added.join("\n")}\n`);
    state.output.info(`[ignore] ${folder.name}: added ${added.join(", ")} to ${IGNORE_FILE}`);

    const what = added.length === 1 ? added[0] : `${added.length} folders`;
    void vscode.window
      .showInformationMessage(
        `ClarifyDoc will skip ${what} from the next analysis of ${folder.name}.`,
        "Re-analyze",
        "Open Ignore File",
      )
      .then((choice) => {
        if (choice === "Re-analyze") void vscode.commands.executeCommand("clarifydoc.analyze", folder);
        if (choice === "Open Ignore File") void vscode.window.showTextDocument(vscode.Uri.file(file));
      });
  }
}
