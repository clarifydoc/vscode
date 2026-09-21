import * as vscode from "vscode";
import * as path from "path";
import { resolveCli, runClarifyDoc } from "./cli";

/**
 * Which files the analyzer can draw a control-flow graph for.
 *
 * The CodeLens has to decide what the flame lens does *before* anyone clicks
 * it, so it cannot find out by trying. It asks the bundled analyzer once per
 * session instead (`clarifydoc cfg --capabilities`), which keeps the answer
 * with the engine: a language plugin that gains a `controlFlow` spec turns the
 * lens on here with no change to the extension.
 *
 * Until the answer arrives — and if it never does, because the analyzer could
 * not be spawned — the lens keeps its old behaviour of opening the Complexity
 * report. Erring that way means the worst case is the lens people already had,
 * rather than one that leads to a view saying "not for this language".
 */

let extensions: Set<string> | undefined;
let inFlight: Promise<void> | undefined;

/** Reset the memoized answer (the CLI resolution changed). */
export function resetControlFlowSupport(): void {
  extensions = undefined;
  inFlight = undefined;
}

async function load(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<void> {
  const cli = resolveCli(context.extensionPath);
  try {
    const result = await runClarifyDoc(cli, ["cfg", "--capabilities"], { cwd: context.extensionPath });
    if (result.code !== 0) {
      output.appendLine(`ClarifyDoc: could not read control-flow capabilities (exit ${result.code}).`);
      return;
    }
    const parsed = JSON.parse(result.stdout) as { extensions?: string[] };
    extensions = new Set((parsed.extensions ?? []).map((e) => e.toLowerCase()));
  } catch (error) {
    output.appendLine(
      `ClarifyDoc: could not read control-flow capabilities — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Start the one-off query. Called from `activate`; failures are logged and
 * never surface, because the fallback is a working lens.
 */
export function primeControlFlowSupport(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  onReady?: () => void,
): void {
  // Lenses drawn before the answer arrives took the fallback, so whoever is
  // showing them is told to draw again once it has.
  inFlight ??= load(context, output).then(() => onReady?.());
  void inFlight;
}

/**
 * Whether this document can have its control flow drawn. False while the
 * answer is still in flight, so the lens never promises a view that is not
 * there; CodeLenses refresh on the next analysis anyway.
 */
export function supportsControlFlow(document: vscode.TextDocument): boolean {
  return extensions?.has(path.extname(document.uri.fsPath).toLowerCase()) ?? false;
}
