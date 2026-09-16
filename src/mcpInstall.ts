import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { resultsDir, storageFor } from "./paths";
import { shimPath } from "./shim";
import { ExtensionState } from "./state";

/**
 * Wiring the MCP server into agents that keep their OWN config file (Claude
 * Code, Cursor, Windsurf, …) rather than reading VS Code's registry.
 *
 * The user should not have to know where that file lives or what shape the
 * entry has, so this writes it — idempotently, merging into whatever is already
 * there — and points it at the version-independent launcher from shim.ts.
 */

export interface ServerEntry {
  command: string;
  args?: string[];
}

/**
 * The entry an external agent needs. With the analysis in the project
 * (`.clarifydoc/`), the launcher finds it from the working directory alone —
 * one entry that works in every project. With the analysis in the extension's
 * private storage, the path is per-folder and has to be spelled out.
 */
export function serverEntry(state: ExtensionState, folder: vscode.WorkspaceFolder): ServerEntry {
  const command = shimPath(state.context);
  if (storageFor(folder).mode === "workspace") return { command };
  return {
    command,
    args: [folder.uri.fsPath, "--analysis-dir", resultsDir(state.context, folder)],
  };
}

export function configJson(entry: ServerEntry): string {
  return JSON.stringify({ mcpServers: { clarifydoc: entry } }, null, 2);
}

type Target =
  | { kind: "claude-cli"; label: string; detail: string }
  | { kind: "json"; label: string; detail: string; file: string; key: "mcpServers" }
  | { kind: "clipboard"; label: string; detail: string };

function claudeAvailable(): boolean {
  const probe = spawnSync("claude", ["--version"], { stdio: "ignore", windowsHide: true, shell: process.platform === "win32" });
  return !probe.error && probe.status === 0;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Everywhere we know how to install, most convenient first. */
async function targetsFor(folder: vscode.WorkspaceFolder): Promise<Target[]> {
  const home = os.homedir();
  const projectMcp = path.join(folder.uri.fsPath, ".mcp.json");
  const cursorProject = path.join(folder.uri.fsPath, ".cursor", "mcp.json");
  const cursorGlobal = path.join(home, ".cursor", "mcp.json");
  const windsurf = path.join(home, ".codeium", "windsurf", "mcp_config.json");

  const targets: Target[] = [];
  if (claudeAvailable()) {
    targets.push({
      kind: "claude-cli",
      label: "Claude Code",
      detail: "claude mcp add — available in every project you open",
    });
  }
  targets.push({
    kind: "json",
    label: "Claude Code (this project)",
    detail: `${projectMcp} — shared with your team if you commit it`,
    file: projectMcp,
    key: "mcpServers",
  });
  targets.push({
    kind: "json",
    label: (await fileExists(cursorProject)) ? "Cursor (this project)" : "Cursor",
    detail: (await fileExists(cursorProject)) ? cursorProject : cursorGlobal,
    file: (await fileExists(cursorProject)) ? cursorProject : cursorGlobal,
    key: "mcpServers",
  });
  targets.push({
    kind: "json",
    label: "Windsurf",
    detail: windsurf,
    file: windsurf,
    key: "mcpServers",
  });
  targets.push({
    kind: "clipboard",
    label: "Copy the config instead",
    detail: "Paste it into any other MCP client",
  });
  return targets;
}

/**
 * Merge our entry into an agent's JSON config without disturbing the rest of
 * it. Returns false when the file exists but is not parseable JSON — better to
 * hand the user the snippet than to rewrite a file we cannot read.
 */
async function mergeIntoJson(file: string, key: string, entry: ServerEntry): Promise<boolean> {
  let root: Record<string, unknown> = {};
  const raw = await fs.readFile(file, "utf-8").catch(() => null);
  if (raw !== null && raw.trim() !== "") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
      root = parsed as Record<string, unknown>;
    } catch {
      return false;
    }
  }
  const servers = (root[key] && typeof root[key] === "object" ? root[key] : {}) as Record<string, unknown>;
  servers.clarifydoc = entry;
  root[key] = servers;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(root, null, 2)}\n`, "utf-8");
  return true;
}

/** `claude mcp add` — user scope when one entry serves every project. */
function installViaClaudeCli(entry: ServerEntry, folder: vscode.WorkspaceFolder): { ok: boolean; message: string } {
  const scope = entry.args?.length ? "local" : "user";
  const args = ["mcp", "add", "clarifydoc", "--scope", scope, "--", entry.command, ...(entry.args ?? [])];
  // `remove` first so re-running repairs a stale entry instead of erroring.
  spawnSync("claude", ["mcp", "remove", "clarifydoc", "--scope", scope], {
    cwd: folder.uri.fsPath,
    stdio: "ignore",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  const run = spawnSync("claude", args, {
    cwd: folder.uri.fsPath,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
  if (run.error || run.status !== 0) {
    return { ok: false, message: output || run.error?.message || "claude mcp add failed" };
  }
  return {
    ok: true,
    message:
      scope === "user"
        ? "Added to Claude Code (user scope) — available in every project."
        : "Added to Claude Code for this project.",
  };
}

/** The command behind "ClarifyDoc: Set Up MCP for an AI Agent". */
export async function installMcpServer(state: ExtensionState, folder: vscode.WorkspaceFolder): Promise<void> {
  const { output } = state;
  const entry = serverEntry(state, folder);

  const targets = await targetsFor(folder);
  const pick = await vscode.window.showQuickPick(
    targets.map((t) => ({ label: t.label, detail: t.detail, target: t })),
    {
      title: "Give an AI agent the ClarifyDoc map",
      placeHolder: "GitHub Copilot in this editor already has it — pick another agent to set up",
      matchOnDetail: true,
    },
  );
  if (!pick) return;
  const target = pick.target;

  if (target.kind === "clipboard") {
    await vscode.env.clipboard.writeText(configJson(entry));
    output.appendLine(`[mcp] copied config:\n${configJson(entry)}`);
    void vscode.window.showInformationMessage("ClarifyDoc: MCP config copied to the clipboard.");
    return;
  }

  if (target.kind === "claude-cli") {
    const result = installViaClaudeCli(entry, folder);
    output.appendLine(`[mcp] claude mcp add: ${result.ok ? "ok" : "failed"} — ${result.message}`);
    if (!result.ok) {
      await vscode.env.clipboard.writeText(configJson(entry));
      void vscode.window.showWarningMessage(
        `ClarifyDoc: could not run \`claude mcp add\` (${result.message}). The config is on your clipboard instead.`,
      );
      return;
    }
    void vscode.window.showInformationMessage(
      `ClarifyDoc: ${result.message} Restart Claude Code to pick it up.`,
    );
    return;
  }

  const merged = await mergeIntoJson(target.file, target.key, entry).catch((err: Error) => {
    output.appendLine(`[mcp] could not write ${target.file}: ${err.message}`);
    return false;
  });
  if (!merged) {
    await vscode.env.clipboard.writeText(configJson(entry));
    void vscode.window.showWarningMessage(
      `ClarifyDoc: ${target.file} could not be updated automatically (unreadable or not JSON). The config is on your clipboard.`,
    );
    return;
  }
  output.appendLine(`[mcp] installed clarifydoc into ${target.file}`);
  const choice = await vscode.window.showInformationMessage(
    `ClarifyDoc: added to ${path.basename(target.file)}. Restart ${target.label} to pick it up.`,
    "Open File",
  );
  if (choice === "Open File") {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target.file));
    await vscode.window.showTextDocument(doc);
  }
}

/**
 * A single nudge, the first time we see a workspace that already configures MCP
 * agents but has no clarifydoc entry — the moment the offer is actually useful.
 */
const NUDGE_KEY = "clarifydoc.mcpNudge.v1";

export async function maybeOfferMcpInstall(state: ExtensionState, folder: vscode.WorkspaceFolder): Promise<void> {
  const { context } = state;
  if (context.globalState.get<string>(NUDGE_KEY)) return;

  const candidates = [
    path.join(folder.uri.fsPath, ".mcp.json"),
    path.join(folder.uri.fsPath, ".cursor", "mcp.json"),
  ];
  let found: string | undefined;
  for (const file of candidates) {
    const raw = await fs.readFile(file, "utf-8").catch(() => null);
    if (raw === null) continue;
    if (raw.includes('"clarifydoc"')) return; // already wired up
    found = file;
    break;
  }
  if (!found) return;

  const choice = await vscode.window.showInformationMessage(
    "This workspace configures MCP agents. Give them the ClarifyDoc map — routes, call traces, blast radius and the data model?",
    "Set Up",
    "Not Now",
    "Never",
  );
  if (choice === "Never") await context.globalState.update(NUDGE_KEY, "never");
  if (choice === "Set Up") {
    await context.globalState.update(NUDGE_KEY, "done");
    await installMcpServer(state, folder);
  }
}
