import * as vscode from "vscode";
import { getConfig } from "./config";
import { bundleAvailable, resolveCli, type ResolvedCli } from "./cli";
import { resultsDir } from "./paths";
import { ExtensionState } from "./state";

/**
 * Exposes the workspace's ClarifyDoc analysis to AI agents over the Model
 * Context Protocol.
 *
 * The server itself is the bundled analyzer (`clarifydoc mcp`, see src/mcp/ in
 * the analyzer repo) — the extension only publishes *how to launch it*, once per
 * workspace folder, pointed at that folder's private analysis directory. So the
 * agent reads exactly what the sidebar and the report show, with no extra scan
 * and no configuration from the user.
 *
 * VS Code 1.101 finalized `lm.registerMcpServerDefinitionProvider`; on older
 * builds this registers nothing (the analyzer, sidebar and report are
 * unaffected) and the "Copy MCP Server Config" command still works for external
 * agents such as Claude Code.
 */
export const MCP_PROVIDER_ID = "clarifydoc.mcp";

/** Args that launch the MCP server for one workspace folder. */
function serverArgs(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
  cli: ResolvedCli,
): string[] {
  const cfg = getConfig(folder.uri);
  const args = [
    ...cli.baseArgs,
    "mcp",
    folder.uri.fsPath,
    "--analysis-dir",
    resultsDir(context, folder),
  ];
  // By default the agent reads what is on disk and never scans: the extension
  // owns analysis runs (command, or analyzeOnSave), and two processes writing
  // one analysis directory would race. Opt in with clarifydoc.mcp.allowAnalyze.
  if (!cfg.mcpAllowAnalyze) args.push("--no-auto-analyze");
  else if (!cfg.gitHistory) args.push("--no-git-history");
  return args;
}

function definitionFor(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
  cli: ResolvedCli,
  multiRoot: boolean,
): vscode.McpStdioServerDefinition {
  const env: Record<string, string | number | null> = {};
  if (cli.electronAsNode) env.ELECTRON_RUN_AS_NODE = "1";
  const version = context.extension?.packageJSON?.version ?? "0.1.0";
  return new vscode.McpStdioServerDefinition(
    multiRoot ? `ClarifyDoc: ${folder.name}` : "ClarifyDoc",
    cli.command,
    serverArgs(context, folder, cli),
    env,
    version,
  );
}

/** True when this VS Code build has the finalized MCP provider API. */
function apiAvailable(): boolean {
  const lm = (vscode as { lm?: { registerMcpServerDefinitionProvider?: unknown } }).lm;
  return (
    typeof lm?.registerMcpServerDefinitionProvider === "function" &&
    typeof (vscode as { McpStdioServerDefinition?: unknown }).McpStdioServerDefinition === "function"
  );
}

export function registerMcpProvider(state: ExtensionState): void {
  const { context, output } = state;

  context.subscriptions.push(
    vscode.commands.registerCommand("clarifydoc.copyMcpConfig", () => copyMcpConfig(state)),
  );

  if (!apiAvailable()) {
    output.appendLine(
      "[mcp] this VS Code build has no MCP provider API (needs 1.101+) — " +
        'use "ClarifyDoc: Copy MCP Server Config" to wire up an external agent.',
    );
    return;
  }

  const changed = new vscode.EventEmitter<void>();
  context.subscriptions.push(changed);

  const provider: vscode.McpServerDefinitionProvider = {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions: () => {
      if (!getConfig().mcpEnabled) return [];
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0) return [];
      const cli = resolveCli(context.extensionPath);
      if (!bundleAvailable(context.extensionPath) && !getConfig().cliPath) {
        output.appendLine("[mcp] bundled analyzer missing — not publishing an MCP server");
        return [];
      }
      return folders.map((folder) => definitionFor(context, folder, cli, folders.length > 1));
    },
    // Called immediately before the editor starts the process.
    resolveMcpServerDefinition: (server) => {
      if (!vscode.workspace.isTrusted) {
        output.appendLine(`[mcp] refusing to start "${server.label}" in an untrusted workspace`);
        void vscode.window.showWarningMessage(
          "ClarifyDoc: the MCP server runs the bundled analyzer and needs a trusted workspace.",
        );
        return undefined;
      }
      // McpServerDefinition also covers HTTP servers, which we never publish.
      if ("command" in server) {
        output.appendLine(`[mcp] starting "${server.label}": ${server.command} ${server.args.join(" ")}`);
      }
      return server;
    },
  };

  context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, provider));

  // Re-publish when the launch inputs change: folders come and go, settings
  // flip the server on/off or into read-write, and a finished analysis is worth
  // announcing so a client that failed on an empty directory retries.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire()),
    state.onAnalysisChanged(() => changed.fire()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("clarifydoc.mcp") ||
        e.affectsConfiguration("clarifydoc.cliPath") ||
        e.affectsConfiguration("clarifydoc.nodePath")
      ) {
        changed.fire();
      }
    }),
  );

  output.appendLine(`[mcp] published MCP server provider "${MCP_PROVIDER_ID}"`);
}

/**
 * Put a ready-to-paste stdio server entry on the clipboard, for agents that
 * read their own config file (Claude Code, Cursor, …) rather than VS Code's
 * MCP registry. Uses the same bundled analyzer and analysis directory the
 * in-editor server uses.
 */
async function copyMcpConfig(state: ExtensionState): Promise<void> {
  const { context, output } = state;
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage("ClarifyDoc: open a folder first.");
    return;
  }
  const folder =
    folders.length === 1
      ? folders[0]
      : await vscode.window.showWorkspaceFolderPick({ placeHolder: "Which folder?" });
  if (!folder) return;

  const cli = resolveCli(context.extensionPath);
  const args = serverArgs(context, folder, cli);
  const config = {
    mcpServers: {
      clarifydoc: {
        command: cli.electronAsNode ? "node" : cli.command,
        args,
        ...(cli.electronAsNode
          ? { comment: "Set command to your node executable — VS Code's Electron runtime is not reusable here." }
          : {}),
      },
    },
  };
  const json = JSON.stringify(config, null, 2);
  await vscode.env.clipboard.writeText(json);
  output.appendLine(`[mcp] copied config for ${folder.name}:\n${json}`);
  const choice = await vscode.window.showInformationMessage(
    `ClarifyDoc: MCP server config for "${folder.name}" copied to the clipboard.`,
    "Show Output",
  );
  if (choice === "Show Output") output.show(true);
}
