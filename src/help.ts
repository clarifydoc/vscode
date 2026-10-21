import * as vscode from "vscode";
import * as path from "path";
import { randomBytes } from "crypto";
import { HELP_CSS, HELP_SCRIPT, renderHelpBody, runnableCommands, type HelpSection } from "./helpContent";
import { WALKTHROUGH } from "./onboarding";
import { ExtensionState } from "./state";

let panel: vscode.WebviewPanel | undefined;

/** The source editor the page's editor actions run on: the help page has
 *  focus when its button is clicked, so it is brought back first. */
let lastEditor: { uri: vscode.Uri; column?: vscode.ViewColumn; selection: vscode.Selection } | undefined;

function remember(editor: vscode.TextEditor | undefined): void {
  if (!editor || editor.document.uri.scheme !== "file") return;
  lastEditor = { uri: editor.document.uri, column: editor.viewColumn, selection: editor.selection };
}

const editorName = () => (lastEditor ? vscode.workspace.asRelativePath(lastEditor.uri) || path.basename(lastEditor.uri.fsPath) : "");

function postEditor(): void {
  void panel?.webview.postMessage({ type: "editor", name: editorName() });
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * "Help": what the extension gives you, every right-click menu with a button
 * that runs its entry, and what each button in the report does. One page,
 * opened beside the editor so the file its actions run on stays in view.
 */
export function showHelp(state: ExtensionState, section?: HelpSection): void {
  remember(vscode.window.activeTextEditor);
  if (panel) {
    panel.reveal(undefined, false);
    postEditor();
    if (section) void panel.webview.postMessage({ type: "section", section });
    return;
  }

  panel = vscode.window.createWebviewPanel("clarifydoc.help", "ClarifyDoc Help", vscode.ViewColumn.Beside, {
    enableScripts: true,
    localResourceRoots: [],
  });
  panel.iconPath = vscode.Uri.file(state.context.asAbsolutePath("media/icon.png"));
  const nonce = randomBytes(16).toString("base64");
  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
  panel.webview.html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>ClarifyDoc Help</title>
<style nonce="${nonce}">${HELP_CSS}</style></head>
<body data-target="${attr(editorName())}" data-section="${section ?? ""}">${renderHelpBody({ mac: process.platform === "darwin" })}
<script nonce="${nonce}">${HELP_SCRIPT}</script></body></html>`;

  const allowed = runnableCommands();
  const subs: vscode.Disposable[] = [
    vscode.window.onDidChangeActiveTextEditor((e) => {
      if (!e) return;
      remember(e);
      postEditor();
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (lastEditor && e.textEditor.document.uri.toString() === lastEditor.uri.toString()) lastEditor.selection = e.textEditor.selection;
    }),
    panel.webview.onDidReceiveMessage(async (msg: { type?: string; command?: unknown }) => {
      if (msg?.type !== "run" || typeof msg.command !== "string") return;
      const on = allowed.get(msg.command);
      if (!on) {
        state.output.warn(`[help] refused to run ${msg.command}: not on the page`);
        return;
      }
      try {
        if (msg.command === "clarifydoc.openWalkthrough") {
          await vscode.commands.executeCommand("workbench.action.openWalkthrough", WALKTHROUGH, false);
          return;
        }
        if (on === "editor") {
          if (!lastEditor) {
            void vscode.window.showInformationMessage("ClarifyDoc: open a source file first, then try it again.");
            return;
          }
          await vscode.window.showTextDocument(lastEditor.uri, { viewColumn: lastEditor.column, selection: lastEditor.selection, preserveFocus: false });
        }
        await vscode.commands.executeCommand(msg.command);
      } catch (e) {
        void vscode.window.showErrorMessage(`ClarifyDoc: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  ];
  panel.onDidDispose(() => {
    for (const s of subs) s.dispose();
    panel = undefined;
  });
}
