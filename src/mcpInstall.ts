import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { resultsDir, storageFor } from "./paths";
import { cliShimPath, shimPath } from "./shim";
import { resolveCli, runClarifyDoc } from "./cli";
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
  | { kind: "json"; label: string; detail: string; file: string; key: "mcpServers"; claude?: true; userLevel?: true }
  | { kind: "toml"; label: string; detail: string; file: string }
  | { kind: "clipboard"; label: string; detail: string };

/** Where Claude Desktop reads its MCP servers on this platform. */
function claudeDesktopConfig(): string {
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return path.join(home, ".config", "Claude", "claude_desktop_config.json");
}

/**
 * Merge our server into a Codex `config.toml` as its own table, replacing
 * an earlier ClarifyDoc table and nothing else. Codex reads user-level
 * config, so the project is always named.
 */
export function mergeCodexToml(existing: string, entry: ServerEntry, root: string): string {
  const args = entry.args?.length ? entry.args : [root];
  const block = `[mcp_servers.clarifydoc]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(args)}\n`;
  const without = existing.replace(/\n?\[mcp_servers\.clarifydoc\]\n(?:(?!\[)[^\n]*\n?)*/g, "\n").replace(/\n{3,}/g, "\n\n");
  return `${without.trimEnd()}${without.trim() ? "\n\n" : ""}${block}`;
}

/** Run the `claude` CLI without blocking the extension host. On Windows it is
 *  a `.cmd` shim, which only a shell can start. */
function runClaude(args: string[], cwd?: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(
      "claude",
      args,
      { cwd, encoding: "utf8", windowsHide: true, timeout: 60_000, shell: process.platform === "win32" },
      (err, stdout, stderr) => {
        const output = `${stdout ?? ""}${stderr ?? ""}`.trim();
        resolve({ ok: !err, output: output || (err?.message ?? "") });
      },
    );
  });
}

async function claudeAvailable(): Promise<boolean> {
  return (await runClaude(["--version"])).ok;
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
  if (await claudeAvailable()) {
    targets.push({
      kind: "claude-cli",
      label: "Claude Code",
      detail: "claude mcp add — available in every project you open",
    });
  }
  targets.push({
    kind: "json",
    label: "Claude Code (this project)",
    // The entry names this machine's extension install, so the file works
    // here only — committed, it would hand teammates a path they do not have.
    detail: `${projectMcp} — this machine only; the entry holds your local path, so don't commit it`,
    file: projectMcp,
    key: "mcpServers",
    claude: true,
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
    userLevel: true,
  });
  const gemini = path.join(folder.uri.fsPath, ".gemini", "settings.json");
  targets.push({ kind: "json", label: "Gemini CLI (this project)", detail: gemini, file: gemini, key: "mcpServers" });
  const codex = path.join(home, ".codex", "config.toml");
  targets.push({ kind: "toml", label: "Codex", detail: `${codex} — names this project`, file: codex });
  const desktop = claudeDesktopConfig();
  targets.push({ kind: "json", label: "Claude Desktop", detail: `${desktop} — names this project`, file: desktop, key: "mcpServers", userLevel: true });
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
async function installViaClaudeCli(
  entry: ServerEntry,
  folder: vscode.WorkspaceFolder,
): Promise<{ ok: boolean; message: string }> {
  const scope = entry.args?.length ? "local" : "user";
  const args = ["mcp", "add", "clarifydoc", "--scope", scope, "--", entry.command, ...(entry.args ?? [])];
  // `remove` first so re-running repairs a stale entry instead of erroring.
  await runClaude(["mcp", "remove", "clarifydoc", "--scope", scope], folder.uri.fsPath);
  const run = await runClaude(args, folder.uri.fsPath);
  if (!run.ok) return { ok: false, message: run.output || "claude mcp add failed" };
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
    output.info(`[mcp] copied config:\n${configJson(entry)}`);
    void vscode.window.showInformationMessage("ClarifyDoc: MCP config copied to the clipboard.");
    return;
  }

  if (target.kind === "claude-cli") {
    const result = await installViaClaudeCli(entry, folder);
    output[result.ok ? "info" : "warn"](`[mcp] claude mcp add: ${result.ok ? "ok" : "failed"} — ${result.message}`);
    if (!result.ok) {
      await vscode.env.clipboard.writeText(configJson(entry));
      void vscode.window.showWarningMessage(
        `ClarifyDoc: could not run \`claude mcp add\` (${result.message}). The config is on your clipboard instead.`,
      );
      return;
    }
    await offerClaudeExtras(state, folder);
    void vscode.window
      .showInformationMessage(`ClarifyDoc: ${result.message} Restart Claude Code to pick it up.`, GUIDANCE_ACTION)
      .then((choice) => offerGuidance(choice, folder));
    return;
  }

  if (target.kind === "toml") {
    try {
      const existing = await fs.readFile(target.file, "utf-8").catch(() => "");
      const next = mergeCodexToml(existing, entry, folder.uri.fsPath);
      if (next !== existing) {
        await fs.mkdir(path.dirname(target.file), { recursive: true });
        await fs.writeFile(target.file, next, "utf-8");
      }
      output.info(`[mcp] installed clarifydoc into ${target.file}`);
      void vscode.window.showInformationMessage(`ClarifyDoc: added to ${target.file}. Restart Codex to pick it up.`, GUIDANCE_ACTION).then((c) => offerGuidance(c, folder));
    } catch (err) {
      await vscode.env.clipboard.writeText(mergeCodexToml("", entry, folder.uri.fsPath));
      void vscode.window.showWarningMessage(`ClarifyDoc: ${target.file} could not be updated (${(err as Error).message}). The table is on your clipboard.`);
    }
    return;
  }

  // A user-level config has no working directory to find the project from: name it.
  const written = target.userLevel && !entry.args?.length ? { ...entry, args: [folder.uri.fsPath] } : entry;
  const merged = await mergeIntoJson(target.file, target.key, written).catch((err: Error) => {
    output.error(`[mcp] could not write ${target.file}: ${err.message}`);
    return false;
  });
  if (!merged) {
    await vscode.env.clipboard.writeText(configJson(entry));
    void vscode.window.showWarningMessage(
      `ClarifyDoc: ${target.file} could not be updated automatically (unreadable or not JSON). The config is on your clipboard.`,
    );
    return;
  }
  output.info(`[mcp] installed clarifydoc into ${target.file}`);
  if (target.claude) await offerClaudeExtras(state, folder);
  const choice = await vscode.window.showInformationMessage(
    `ClarifyDoc: added to ${path.basename(target.file)}. Restart ${target.label} to pick it up.`,
    "Open File",
    GUIDANCE_ACTION,
  );
  if (choice === "Open File") {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target.file));
    await vscode.window.showTextDocument(doc);
  }
  await offerGuidance(choice, folder);
}

/**
 * Claude Code can do more than call the server: hooks that put what the map
 * knows beside a search, a new file, an edit or a new session, and skills made from the
 * ClarifyDoc workflows. Opt-in, through the CLI's own installer pointed at
 * the extension's stable launcher, so an update never breaks them; it
 * writes only what changed.
 */
async function offerClaudeExtras(state: ExtensionState, folder: vscode.WorkspaceFolder): Promise<void> {
  const picks = await vscode.window.showQuickPick(
    [
      { label: "Hooks", detail: "Before Grep/Glob: what the map knows about the name. Before a new file: what already exists under its name. After an edit: who depends on the file, and the decision records naming it. At session start: what the map covers. Never blocks.", flag: "--hooks" },
      { label: "Skills", detail: "One Claude Code skill per ClarifyDoc workflow (before editing, before writing, trace a feature, review a branch…)", flag: "--skills" },
    ],
    { canPickMany: true, title: "Also set up for Claude Code (optional)", placeHolder: "Pick none to skip" },
  );
  if (!picks?.length) return;
  const cli = await resolveCli(state.context.extensionPath);
  const args = ["install", folder.uri.fsPath, "--no-mcp", ...picks.map((p) => p.flag), "--command", cliShimPath(state.context)];
  const res = await runClarifyDoc(cli, args, { cwd: folder.uri.fsPath });
  state.output[res.code === 0 ? "info" : "warn"](`[mcp] clarifydoc ${args.join(" ")}: ${res.stdout.trim() || res.stderr.trim()}`);
  if (res.code !== 0) void vscode.window.showWarningMessage(`ClarifyDoc: could not add ${picks.map((p) => p.label.toLowerCase()).join(" and ")} (see the output).`);
}

/** Installing the server says the tools exist; the guidance says when to use them. */
const GUIDANCE_ACTION = "Tell Agents When to Use It";

async function offerGuidance(choice: string | undefined, folder: vscode.WorkspaceFolder): Promise<void> {
  if (choice === GUIDANCE_ACTION) await vscode.commands.executeCommand("clarifydoc.installAgentGuidance", folder);
}

/**
 * A single nudge, the first time we see a workspace that already configures MCP
 * agents but has no clarifydoc entry — the moment the offer is actually useful.
 */
const NUDGE_KEY = "clarifydoc.mcpNudge.v1";

/** Offer once, for this folder, if it qualifies. Resolves whether it asked. */
export async function maybeOfferMcpInstall(state: ExtensionState, folder: vscode.WorkspaceFolder): Promise<boolean> {
  const { context } = state;
  if (context.globalState.get<string>(NUDGE_KEY)) return false;

  const candidates = [
    path.join(folder.uri.fsPath, ".mcp.json"),
    path.join(folder.uri.fsPath, ".cursor", "mcp.json"),
  ];
  let found: string | undefined;
  for (const file of candidates) {
    const raw = await fs.readFile(file, "utf-8").catch(() => null);
    if (raw === null) continue;
    if (raw.includes('"clarifydoc"')) return false; // already wired up
    found = file;
    break;
  }
  if (!found) return false;

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
  return true;
}
