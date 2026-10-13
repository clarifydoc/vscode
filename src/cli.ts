import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ChildProcess, execFile, spawn } from "child_process";
import { getConfig } from "./config";

/**
 * How the bundled ClarifyDoc analyzer is invoked. The extension ships its own
 * copy of the CLI (see scripts/bundle-cli.mjs → `clarifydoc/`) and runs it in an
 * isolated child process, so it never depends on a repo checkout, a global
 * install, or the workspace's node_modules.
 */
export interface ResolvedCli {
  /** Executable to spawn (a Node binary, or VS Code itself in Electron-as-node mode). */
  command: string;
  /** Args prepended before the clarifydoc subcommand (the cli.js path). */
  baseArgs: string[];
  /** Run VS Code's own binary as Node (ELECTRON_RUN_AS_NODE) — no external Node needed. */
  electronAsNode: boolean;
  /** Human-readable description shown in logs. */
  display: string;
}

let cachedResolution: Promise<ResolvedCli> | null = null;

/** Reset the memoized CLI resolution (call when settings change). */
export function resetCliResolution(): void {
  cachedResolution = null;
}

function existingFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Absolute path to the analyzer bundled inside the extension. */
export function bundledCliPath(extensionPath: string): string {
  return path.join(extensionPath, "clarifydoc", "dist", "cli.js");
}

/**
 * Pick the Node runtime. Preference:
 *   1. an explicit `clarifydoc.nodePath`;
 *   2. `node` from PATH, if present (zero-config on machines that have Node);
 *   3. VS Code's own binary run as Node via ELECTRON_RUN_AS_NODE — always
 *      available, so the extension works with no external Node at all.
 * The bundled analyzer is pure JS + WASM (no native addons), so any of these
 * runs it identically.
 */
async function resolveNode(): Promise<{ command: string; electronAsNode: boolean }> {
  const cfg = getConfig();
  if (cfg.nodePath) return { command: cfg.nodePath, electronAsNode: false };
  // Probed asynchronously: activation resolves the CLI, and a blocking probe
  // holds every extension in the host for as long as `node` takes to start.
  const onPath = await new Promise<boolean>((resolve) => {
    execFile("node", ["--version"], { windowsHide: true, timeout: 10_000 }, (err) => resolve(!err));
  });
  if (onPath) return { command: "node", electronAsNode: false };
  return { command: process.execPath, electronAsNode: true };
}

/**
 * Resolve how to invoke the analyzer:
 *   1. `clarifydoc.cliPath` setting (advanced override — a .js file or binary);
 *   2. the bundled `clarifydoc/dist/cli.js` shipped inside the extension.
 */
export function resolveCli(extensionPath: string): Promise<ResolvedCli> {
  cachedResolution ??= resolveCliUncached(extensionPath);
  return cachedResolution;
}

async function resolveCliUncached(extensionPath: string): Promise<ResolvedCli> {
  const cfg = getConfig();
  const node = await resolveNode();
  const runtime = node.electronAsNode ? "VS Code (Electron-as-Node)" : node.command;

  // 1. Advanced override.
  if (cfg.cliPath) {
    const resolved = path.isAbsolute(cfg.cliPath)
      ? cfg.cliPath
      : path.resolve(extensionPath, cfg.cliPath);
    if (resolved.endsWith(".js")) {
      return {
        command: node.command,
        baseArgs: [resolved],
        electronAsNode: node.electronAsNode,
        display: `${runtime} ${resolved} (cliPath)`,
      };
    }
    return {
      command: resolved,
      baseArgs: [],
      electronAsNode: false,
      display: `${resolved} (cliPath)`,
    };
  }

  // 2. Bundled analyzer.
  const bundled = bundledCliPath(extensionPath);
  return {
    command: node.command,
    baseArgs: [bundled],
    electronAsNode: node.electronAsNode,
    display: `${runtime} ${bundled} (bundled)`,
  };
}

/** Whether the bundled analyzer is present (false ⇒ the bundle step didn't run). */
export function bundleAvailable(extensionPath: string): boolean {
  return existingFile(bundledCliPath(extensionPath));
}

/**
 * Turn a spawn failure into a user-facing message. Returns `undefined` so
 * callers can write `.catch((e) => reportSpawnError(e, cli))` and treat a
 * missing result as "handled". Cancellation is swallowed silently.
 */
export function reportSpawnError(err: unknown, cli: ResolvedCli): undefined {
  if (err instanceof vscode.CancellationError) return undefined;
  const e = err as NodeJS.ErrnoException;
  if (e?.code === "ENOENT") {
    void vscode.window
      .showErrorMessage(
        `ClarifyDoc: could not launch the analyzer runtime "${cli.command}". Set "clarifydoc.nodePath" to a Node.js executable.`,
        "Open Settings",
      )
      .then((choice) => {
        if (choice === "Open Settings") {
          void vscode.commands.executeCommand("workbench.action.openSettings", "clarifydoc");
        }
      });
  } else {
    void vscode.window.showErrorMessage(`ClarifyDoc: ${(err as Error).message}`);
  }
  return undefined;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd: string;
  /** Called for each chunk of combined stdout/stderr as it arrives. */
  onOutput?: (chunk: string) => void;
  token?: vscode.CancellationToken;
  /** Keep stdout in `RunResult.stdout` (default). A command whose output is
   *  only streamed — `analyze --verbose` prints a line per file — passes false
   *  rather than holding all of it in the extension host. */
  captureStdout?: boolean;
}

/** stderr is kept for error messages; only its tail matters, and a runaway
 *  warning loop must not grow the extension host without bound. */
const STDERR_TAIL = 256 * 1024;

/** Every analyzer process still running, so deactivation can stop them. */
const children = new Set<ChildProcess>();

/** Stop every analyzer process this extension started (on deactivate). */
export function killAllChildren(): void {
  for (const child of children) child.kill();
  children.clear();
}

/**
 * Spawn a clarifydoc subcommand as an isolated child process. Streams output
 * through `onOutput`, honours a cancellation token, and resolves with the exit
 * code + captured output. Rejects only when the process cannot be spawned.
 */
export function runClarifyDoc(
  cli: ResolvedCli,
  args: string[],
  opts: RunOptions,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const fullArgs = [...cli.baseArgs, ...args];
    const env = { ...process.env };
    if (cli.electronAsNode) {
      env.ELECTRON_RUN_AS_NODE = "1";
    }
    const child = spawn(cli.command, fullArgs, {
      cwd: opts.cwd,
      env,
      windowsHide: true,
    });
    children.add(child);
    const captureStdout = opts.captureStdout ?? true;

    let stdout = "";
    let stderr = "";
    let killed = false;

    const cancelSub = opts.token?.onCancellationRequested(() => {
      killed = true;
      child.kill();
    });

    // Decoded as a stream, so a multi-byte character split across two chunks
    // arrives whole.
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (s: string) => {
      if (captureStdout) stdout += s;
      opts.onOutput?.(s);
    });
    child.stderr?.on("data", (s: string) => {
      stderr += s;
      if (stderr.length > STDERR_TAIL * 2) stderr = stderr.slice(-STDERR_TAIL);
      opts.onOutput?.(s);
    });

    child.on("error", (err) => {
      children.delete(child);
      cancelSub?.dispose();
      reject(err);
    });

    child.on("close", (code) => {
      children.delete(child);
      cancelSub?.dispose();
      if (stderr.length > STDERR_TAIL) stderr = stderr.slice(-STDERR_TAIL);
      if (killed) {
        reject(new vscode.CancellationError());
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}
