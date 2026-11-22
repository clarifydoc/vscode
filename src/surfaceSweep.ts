import * as path from "path";
import * as fs from "fs/promises";
import { execFile } from "child_process";

/**
 * Compare checks the base out in a detached git worktree named `base-<commit>`
 * under the extension's storage and removes it when the run ends. A run that
 * died before its cleanup (window closed, crash) leaves the worktree and git's
 * record of it; this sweeps both. Only directories this extension names that
 * way, inside its own `trees` folder, are touched — never another tool's
 * worktree of the same repository. No `vscode` import, so it is testable.
 */

/** The names compare gives its worktrees. */
export const TREE_NAME = /^base-[0-9a-f]{1,40}$/;

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("git", ["-c", "core.fsmonitor=false", "-C", cwd, ...args], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout),
    ),
  );
}

/** Trees of runs in this window, so deactivate can sweep them without being told where they are. */
const known = new Set<string>();

function key(repo: string, treesDir: string): string {
  return JSON.stringify([repo, treesDir]);
}

/** Note that compare uses `treesDir` for `repo`. */
export function rememberTrees(repo: string, treesDir: string): void {
  known.add(key(repo, treesDir));
}

/**
 * Remove every compare worktree left in `treesDir` (except `keep`, the names a
 * live run owns) and prune git's worktree list of the ones whose directory is
 * gone. Returns the names removed. Never throws: a sweep must not stop a run.
 */
export async function sweepTrees(repo: string, treesDir: string, keep: readonly string[] = []): Promise<string[]> {
  const removed: string[] = [];
  let names: string[] = [];
  try {
    names = await fs.readdir(treesDir);
  } catch {
    // no trees folder: nothing was left
  }
  for (const name of names) {
    if (!TREE_NAME.test(name) || keep.includes(name)) continue;
    const tree = path.join(treesDir, name);
    await git(repo, ["worktree", "remove", "--force", tree]).catch(() => undefined);
    await fs.rm(tree, { recursive: true, force: true }).catch(() => undefined);
    removed.push(name);
  }
  await git(repo, ["worktree", "prune"]).catch(() => undefined);
  return removed;
}

/** Sweep everything this window's compare runs used (deactivate). */
export async function sweepKnownTrees(): Promise<void> {
  await Promise.all([...known].map((k) => {
    const [repo, treesDir] = JSON.parse(k) as [string, string];
    return sweepTrees(repo, treesDir);
  }));
}
