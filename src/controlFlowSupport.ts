import * as vscode from "vscode";
import * as path from "path";
import { rememberedAnswer, resolveCli, runClarifyDoc } from "./cli";

/**
 * Which files the analyzer can draw a control-flow graph for.
 *
 * The CodeLens has to decide what the flame lens does *before* anyone clicks
 * it, so it cannot find out by trying. It asks the bundled analyzer
 * (`clarifydoc cfg --capabilities`) and remembers the answer per analyzer
 * build, which keeps the answer with the engine: a language plugin that gains
 * a `controlFlow` spec turns the lens on here with no change to the extension.
 *
 * Until the answer arrives — and if it never does, because the analyzer could
 * not be spawned — the lens keeps its old behaviour of opening the Complexity
 * report. Erring that way means the worst case is the lens people already had,
 * rather than one that leads to a view saying "not for this language".
 */

let extensions: Set<string> | undefined;
let inFlight: Promise<void> | undefined;
const changed = new vscode.EventEmitter<void>();

/**
 * Fires when the answer arrives. Lenses drawn before it took the fallback, so
 * whoever shows them draws again — only them: no analysis changed.
 */
export const onDidChangeControlFlowSupport: vscode.Event<void> = changed.event;

/** Reset the memoized answer (the CLI resolution changed). */
export function resetControlFlowSupport(): void {
  extensions = undefined;
  inFlight = undefined;
}

async function load(context: vscode.ExtensionContext, output: vscode.LogOutputChannel): Promise<void> {
  const cli = await resolveCli(context.extensionPath);
  const list = await rememberedAnswer(context, cli, "cfgCapabilities", async () => {
    try {
      const result = await runClarifyDoc(cli, ["cfg", "--capabilities"], { cwd: context.extensionPath });
      if (result.code !== 0) {
        output.warn(`[cfg] could not read control-flow capabilities (exit ${result.code}).`);
        return undefined;
      }
      const parsed = JSON.parse(result.stdout) as { extensions?: string[] };
      return (parsed.extensions ?? []).map((e) => e.toLowerCase());
    } catch (error) {
      output.warn(
        `[cfg] could not read control-flow capabilities — ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  });
  if (list) extensions = new Set(list);
}

/**
 * Start the one-off query. Called from `activate`; failures are logged and
 * never surface, because the fallback is a working lens.
 */
export function primeControlFlowSupport(context: vscode.ExtensionContext, output: vscode.LogOutputChannel): void {
  inFlight ??= load(context, output).then(() => changed.fire());
  void inFlight;
}

/**
 * Whether this document can have its control flow drawn. False while the
 * answer is still in flight, so the lens never promises a view that is not
 * there.
 */
export function supportsControlFlow(document: vscode.TextDocument): boolean {
  return extensions?.has(path.extname(document.uri.fsPath).toLowerCase()) ?? false;
}
