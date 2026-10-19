import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { execFile } from "child_process";
import { getConfig } from "./config";
import { resolveCli, runClarifyDoc } from "./cli";
import { folderKey, resultsDir } from "./paths";
import type { CompareBase } from "./compareBase";
import type { SurfaceDiff } from "./surfaceModel";

/**
 * The API surface of the compared base, so the Impact view can say what the
 * branch changes in it — a route removed or moved, a guard lost — which
 * projecting the change onto today's analysis cannot see.
 *
 * The base is analyzed once per commit: checked out in a temporary detached
 * git worktree, seeded with a copy of the workspace's analysis so only the
 * files that differ reparse (the copy's mtimes are cleared, so every file is
 * judged by its content), then the worktree is removed and the analysis kept
 * under the extension's storage. Diffing it against the workspace's current
 * analysis (`clarifydoc diff --json`) is cheap and runs on every refresh.
 */

const short = (commit: string) => commit.slice(0, 12);

function surfaceRoot(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): string {
  return path.join(context.globalStorageUri.fsPath, "surface", folderKey(folder));
}

/** Where the base commit's analysis lives (`-o <out>` of a worktree named `base-<commit>`). */
export function baseAnalysisDir(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder, commit: string): string {
  return path.join(surfaceRoot(context, folder), "out", `base-${short(commit)}`);
}

async function manifestVersion(dir: string): Promise<string | null> {
  try {
    return (JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8")) as { extractorVersion?: string }).extractorVersion ?? null;
  } catch {
    return null;
  }
}

/** Whether the base's analysis exists and was made by the extractor that made the workspace's. */
export async function hasBaseAnalysis(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder, commit: string): Promise<boolean> {
  const dir = baseAnalysisDir(context, folder, commit);
  if (!existsSync(path.join(dir, "project-summary.json"))) return false;
  const head = await manifestVersion(resultsDir(context, folder));
  return !head || head === (await manifestVersion(dir));
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("git", ["-C", cwd, ...args], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout),
    ),
  );
}

/** Analyze the base commit (see the module comment). Throws with what failed. */
export async function analyzeBase(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
  base: CompareBase,
  report: (message: string) => void,
  token?: vscode.CancellationToken,
): Promise<void> {
  const root = surfaceRoot(context, folder);
  const name = `base-${short(base.commit)}`;
  const tree = path.join(root, "trees", name);
  const out = path.join(root, "out");
  const dir = path.join(out, name);
  const head = resultsDir(context, folder);
  const repo = folder.uri.fsPath;

  await git(repo, ["worktree", "remove", "--force", tree]).catch(() => undefined);
  await fs.rm(tree, { recursive: true, force: true });
  await fs.mkdir(path.dirname(tree), { recursive: true });
  report(`checking out ${base.label}`);
  await git(repo, ["worktree", "add", "--detach", tree, base.commit]);
  try {
    // Seed with the workspace's analysis: unchanged files are reused by their hash.
    await fs.rm(dir, { recursive: true, force: true });
    if (existsSync(path.join(head, "manifest.json"))) {
      await fs.cp(head, dir, { recursive: true, filter: (src) => !src.endsWith("report.html") });
      const manifestPath = path.join(dir, "manifest.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { entries?: Record<string, { mtime: number; sha256: string }> };
      for (const e of Object.values(manifest.entries ?? {})) e.mtime = -1;
      await fs.writeFile(manifestPath, JSON.stringify(manifest));
    }
    report(`analyzing ${base.label}`);
    const cfg = getConfig(folder.uri);
    const args = ["analyze", tree, "-o", out, "--incremental", "--no-lsp", "--no-git-history", "--no-pretty"];
    if (cfg.maxFiles > 0) args.push("--max-files", String(cfg.maxFiles));
    if (cfg.includeGlobs.length) args.push("--include", ...cfg.includeGlobs);
    if (cfg.excludeGlobs.length) args.push("--exclude", ...cfg.excludeGlobs);
    const cli = await resolveCli(context.extensionPath);
    const result = await runClarifyDoc(cli, args, { cwd: tree, token, captureStdout: false });
    if (token?.isCancellationRequested) throw new Error("cancelled");
    if (result.code !== 0) throw new Error(`analysis of ${base.label} exited ${result.code}: ${result.stderr.trim().split("\n").pop() ?? ""}`);
  } finally {
    await git(repo, ["worktree", "remove", "--force", tree]).catch(() => undefined);
    await fs.rm(tree, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** `clarifydoc diff --json` of the base's analysis against the workspace's. */
export async function diffWithBase(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder, commit: string): Promise<SurfaceDiff> {
  const cli = await resolveCli(context.extensionPath);
  const result = await runClarifyDoc(cli, ["diff", baseAnalysisDir(context, folder, commit), resultsDir(context, folder), "--json"], { cwd: folder.uri.fsPath });
  if (result.code !== 0) throw new Error(result.stderr.trim().split("\n").pop() ?? `exit ${result.code}`);
  return JSON.parse(result.stdout) as SurfaceDiff;
}
