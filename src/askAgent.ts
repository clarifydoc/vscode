import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { loadAnalyzer, loadFileIndex, WorkflowPrompt } from "./analysisData";
import { docFacts } from "./docFacts";

/** What the cursor says about a prompt's arguments. */
async function contextArgs(state: ExtensionState): Promise<Record<string, string>> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return {};
  const d = await docFacts(state, editor.document);
  const line = editor.selection.active.line;
  const word = (() => {
    const r = editor.document.getWordRangeAtPosition(editor.selection.active);
    return r ? editor.document.getText(r) : undefined;
  })();
  if (!d) return word ? { feature: word } : {};
  const args: Record<string, string> = { file: d.rel };
  const idx = await loadFileIndex(state.context, d.folder, d.rel, d.facts);
  // The function the cursor is in: the nearest definition at or above it.
  const fn = [...idx.defs].reverse().find((x) => x.kind === "function" && (state.lines.map(editor.document.uri, x.line - 1) ?? Infinity) <= line);
  if (fn) args.symbol = fn.symbol;
  const route = d.facts.routes.find((r) => d.isAt(r.line, line)) ?? (d.facts.routes.length === 1 ? d.facts.routes[0] : undefined);
  if (route) {
    args.path = route.path;
    if (route.httpMethod) args.method = route.httpMethod;
  }
  const screen = d.analysis.crossTier.screensByFile.get(d.rel)?.[0];
  if (screen?.title) args.screen = screen.title;
  args.feature = screen?.title ?? word ?? "";
  if (!args.feature) delete args.feature;
  return args;
}

/**
 * "Ask an AI Agent…": one of the MCP server's workflows, its arguments filled
 * from where the cursor is (the file, the function, the route, the screen),
 * opened in the chat — or copied, where this editor has no chat to open.
 */
export async function askAgent(state: ExtensionState): Promise<void> {
  const prompts = (await loadAnalyzer(state.context))?.WORKFLOW_PROMPTS;
  if (!prompts?.length) {
    void vscode.window.showErrorMessage("ClarifyDoc: the bundled analyzer has no agent workflows. Update the extension.");
    return;
  }
  const known = await contextArgs(state);
  const ready = (p: WorkflowPrompt) => p.arguments.every((a) => !a.required || known[a.name]);
  const items = [...prompts]
    .sort((a, b) => Number(ready(b)) - Number(ready(a)))
    .map((p) => ({
      label: p.title ?? p.name,
      detail: p.description,
      description: p.arguments.filter((a) => known[a.name]).map((a) => `${a.name}: ${known[a.name]}`).join(" · "),
      prompt: p,
    }));
  const pick = await vscode.window.showQuickPick(items, {
    title: "Ask an AI agent, with ClarifyDoc's tools",
    placeHolder: "A workflow — its arguments are filled from where your cursor is",
    matchOnDetail: true,
  });
  if (!pick) return;

  const args: Record<string, string> = {};
  for (const a of pick.prompt.arguments) {
    if (known[a.name]) {
      args[a.name] = known[a.name];
      continue;
    }
    const value = await vscode.window.showInputBox({ title: pick.label, prompt: a.description, ignoreFocusOut: true });
    if (value === undefined) return;
    if (value) args[a.name] = value;
    else if (a.required) return;
  }
  const text = pick.prompt.render(args);

  const commands = await vscode.commands.getCommands(true);
  if (commands.includes("workbench.action.chat.open")) {
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: text });
    return;
  }
  await vscode.env.clipboard.writeText(text);
  void vscode.window.showInformationMessage("ClarifyDoc: this editor has no chat to open — the request is on your clipboard for your agent.");
}
