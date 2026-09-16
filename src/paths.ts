import * as path from "path";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import { accessSync, constants } from "fs";
import * as vscode from "vscode";
import { getConfig } from "./config";

/**
 * Where analysis artifacts go. Two layouts, and the choice is what makes the
 * MCP server easy to point at:
 *
 *   workspace (default)
 *     <workspaceFolder>/.clarifydoc/<project-name>/{project-summary.json, report.html, …}
 *     Exactly where `clarifydoc analyze` writes with its default `-o`, and
 *     exactly where `clarifydoc mcp` looks with no arguments — so ANY agent
 *     launched in the project finds this analysis with no configuration, and a
 *     CLI run and the extension share one copy (and one incremental cache).
 *     The analyzer drops a self-ignoring `.gitignore` in there, so it never
 *     appears in `git status` and never touches the user's own ignore file.
 *
 *   global (fallback, or `clarifydoc.storage: "global"`)
 *     <globalStorage>/analyses/<folder-key>/<project-name>/…
 *     The project tree is left completely untouched. Used automatically when
 *     the workspace is untrusted or not writable (read-only checkouts, network
 *     mounts, containers), so analysis still works there.
 *
 * <folder-key> mixes the basename with a hash of the absolute path so two
 * folders that share a name never collide.
 */
export function projectName(folder: vscode.WorkspaceFolder): string {
  return path.basename(folder.uri.fsPath);
}

export function folderKey(folder: vscode.WorkspaceFolder): string {
  const hash = crypto.createHash("sha1").update(folder.uri.fsPath).digest("hex").slice(0, 8);
  const base = projectName(folder).replace(/[^\w.-]+/g, "_") || "workspace";
  return `${base}-${hash}`;
}

export function analysesRoot(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "analyses");
}

/** The directory a project-local analysis lives in. */
export function workspaceBaseDir(folder: vscode.WorkspaceFolder): string {
  return path.join(folder.uri.fsPath, ".clarifydoc");
}

/**
 * Whether this folder can hold the analysis itself. Untrusted workspaces are
 * excluded because writing into them is exactly what restricted mode is for;
 * unwritable ones because the analysis would fail halfway through.
 *
 * Memoized: the path accessors below are synchronous and called from CodeLens,
 * hovers and the tree, so this must not stat on every call.
 */
const writableCache = new Map<string, boolean>();

function canWriteInto(dir: string): boolean {
  const cached = writableCache.get(dir);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    accessSync(dir, constants.W_OK);
    ok = true;
  } catch {
    ok = false;
  }
  writableCache.set(dir, ok);
  return ok;
}

/** Drop the memoized writability probes (trust granted, folders changed). */
export function resetStorageResolution(): void {
  writableCache.clear();
}

export type StorageMode = "workspace" | "global";

/** Which layout is actually in effect for this folder, and why. */
export function storageFor(folder: vscode.WorkspaceFolder): { mode: StorageMode; reason?: string } {
  if (getConfig(folder.uri).storage === "global") return { mode: "global" };
  if (!vscode.workspace.isTrusted) return { mode: "global", reason: "workspace is not trusted" };
  if (!canWriteInto(folder.uri.fsPath)) return { mode: "global", reason: "workspace is not writable" };
  return { mode: "workspace" };
}

/** Absolute base output directory passed to the CLI via `-o`. */
export function outputBaseDir(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): string {
  return storageFor(folder).mode === "workspace"
    ? workspaceBaseDir(folder)
    : path.join(analysesRoot(context), folderKey(folder));
}

/** Absolute directory that holds project-summary.json / report.html. */
export function resultsDir(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): string {
  return path.join(outputBaseDir(context, folder), projectName(folder));
}

export function summaryPath(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): string {
  return path.join(resultsDir(context, folder), "project-summary.json");
}

export function reportPath(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): string {
  return path.join(resultsDir(context, folder), "report.html");
}

/** Ensure the per-folder output base exists before the CLI writes into it. */
export async function ensureOutputDir(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
): Promise<string> {
  const dir = outputBaseDir(context, folder);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
