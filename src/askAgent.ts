import * as vscode from "vscode";
import { ExtensionState } from "./state";
import { loadAnalyzer, loadFileIndex, WorkflowPrompt } from "./analysisData";
import { docFacts } from "./docFacts";

/** A selection read as a few words saying what new code will do: one line, comment markers dropped, short. */
export function selectionWords(text: string): string | undefined {
  const words = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\/\/+|#+|--|\/\*+|\*+\/?|<!--)\s?/, "").replace(/\s*(?:\*\/|-->)\s*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return words && words.length <= 120 ? words : undefined;
}

/**
 * The third-party package an import on this line names — a bare specifier
 * (`"date-fns"`, `"@scope/pkg/sub"` → `@scope/pkg`, Python `from requests import …`),
 * never a relative path, a project alias or a runtime built-in.
 */
export function importedPackage(line: string): string | undefined {
  const quoted =
    /^\s*(?:import\b[^"'`]*?\bfrom\s*|import\s*|export\b[^"'`]*?\bfrom\s*)["']([^"']+)["']/.exec(line) ??
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/.exec(line);
  const py = quoted ? undefined : /^\s*(?:from\s+([A-Za-z_][\w.]*)\s+import\b|import\s+([A-Za-z_][\w.]*)\s*$)/.exec(line);
  const spec = quoted?.[1] ?? (py ? (py[1] ?? py[2])!.split(".")[0] : undefined);
  if (!spec || /^(?:\.|\/|#|~\/|@\/|node:)/.test(spec)) return undefined;
  const parts = spec.split("/");
  if (spec.startsWith("@")) return parts.length >= 2 ? parts.slice(0, 2).join("/") : undefined;
  // A module path that starts with a host (Go's github.com/club/league) is the package as written.
  return parts[0]!.includes(".") ? spec : parts[0];
}

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
  // Before writing: the selected words say what the code will do; an import line names the package.
  const writing: Record<string, string> = {};
  const what = editor.selection.isEmpty ? undefined : selectionWords(editor.document.getText(editor.selection));
  if (what) writing.what = what;
  const pkg = importedPackage(editor.document.lineAt(line).text);
  if (pkg) writing.package = pkg;
  if (!d) return word ? { feature: word, ...writing } : writing;
  const args: Record<string, string> = { file: d.rel, ...writing };
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
