import * as path from "path";

/**
 * Layer 2 through the editor's own language servers, minus the editor: the
 * questions the analyzer wrote (`lsp-update --emit-queries`), the answers it
 * reads back (`--answers`), and the budgeted loop between them. Kept free of
 * the `vscode` module so it is tested as plain functions.
 */

/** One question, as `lsp-update --emit-queries` writes it: 1-based line, 0-based column. */
export interface DefinitionQuery {
  file: string;
  line: number;
  column: number;
  callName: string;
  language: string;
}

export interface DefinitionAnswer {
  file: string;
  line: number;
  column: number;
  targets: Array<{ file: string; line: number }>;
}

/** A provider's answer as VS Code returns it: a Location or a LocationLink. */
export type ProviderLocation =
  | { uri: { fsPath: string }; range: { start: { line: number } } }
  | { targetUri: { fsPath: string }; targetSelectionRange?: { start: { line: number } }; targetRange: { start: { line: number } } };

/**
 * Where each answer points, project-relative and posix, 1-based. A location
 * outside the project (a library, a stub, the standard library) is left out:
 * the analyzer has no file there to link to.
 */
export function targetsOf(locations: readonly ProviderLocation[] | undefined, projectRoot: string): DefinitionAnswer["targets"] {
  const out: DefinitionAnswer["targets"] = [];
  for (const loc of locations ?? []) {
    const fsPath = "targetUri" in loc ? loc.targetUri.fsPath : loc.uri.fsPath;
    const start = "targetUri" in loc ? (loc.targetSelectionRange ?? loc.targetRange).start : loc.range.start;
    const rel = path.relative(projectRoot, fsPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    out.push({ file: rel.split(path.sep).join("/"), line: start.line + 1 });
  }
  return out;
}

export interface PassLimits {
  /** At most this many questions. */
  maxQueries: number;
  /** Stop asking after this long (ms); what was answered is kept. */
  deadlineMs: number;
  /** Questions in flight at once. */
  concurrency: number;
  /** A question unanswered after this long counts as a timeout (ms). */
  perQueryMs: number;
  /** A language whose server timed out this many times in a row is not asked again (still indexing, or hung). */
  maxTimeoutsInARow: number;
}

export const DEFAULT_LIMITS: PassLimits = { maxQueries: 2000, deadlineMs: 120_000, concurrency: 8, perQueryMs: 5_000, maxTimeoutsInARow: 5 };

export interface PassResult {
  /** Every question put, in query order — with `targets: []` where the server had nothing. */
  answers: DefinitionAnswer[];
  asked: number;
  answered: number;
  timeouts: number;
  /** Languages given up on after repeated timeouts. */
  gaveUp: string[];
  /** Why the pass stopped before the end: `budget`, `deadline`, `cancelled`. */
  stopped?: "budget" | "deadline" | "cancelled";
  /** Languages with at least one answer. */
  languages: string[];
  /** Questions asked again because their server was still starting when they were first put. */
  retried: number;
}

const TIMEOUT = Symbol("timeout");
const FAILED = Symbol("failed");

/**
 * Put the questions to `ask` within the limits. A question that timed out or
 * failed is left out of the answers — the analyzer then skips it rather than
 * recording "no definition", which would be a claim the server never made.
 */
export async function runDefinitionPass(
  queries: readonly DefinitionQuery[],
  ask: (q: DefinitionQuery) => Promise<readonly ProviderLocation[] | undefined>,
  projectRoot: string,
  limits: PassLimits = DEFAULT_LIMITS,
  isCancelled: () => boolean = () => false,
  now: () => number = Date.now,
): Promise<PassResult> {
  const started = now();
  const slots: (DefinitionAnswer | undefined)[] = new Array(Math.min(queries.length, limits.maxQueries));
  const inARow = new Map<string, number>();
  const gaveUp = new Set<string>();
  const languages = new Set<string>();
  let next = 0;
  let asked = 0;
  let answered = 0;
  let timeouts = 0;
  let stopped: PassResult["stopped"];
  let retried = 0;
  // Completion order, per question and per language's first real answer: a
  // server still loading the project answers nothing at first (tsserver: the
  // first couple of seconds), so what it said "nothing" to before it said
  // anything is asked again at the end.
  let seq = 0;
  const doneAt: number[] = [];
  const firstAnswerAt = new Map<string, number>();

  const askOnce = async (q: DefinitionQuery): Promise<DefinitionAnswer["targets"] | typeof TIMEOUT | typeof FAILED> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      ask(q).catch((): typeof FAILED => FAILED),
      new Promise<typeof TIMEOUT>((r) => (timer = setTimeout(() => r(TIMEOUT), limits.perQueryMs))),
    ]);
    clearTimeout(timer);
    return outcome === TIMEOUT || outcome === FAILED ? outcome : targetsOf(outcome, projectRoot);
  };

  const worker = async () => {
    while (next < queries.length) {
      if (isCancelled()) return void (stopped = "cancelled");
      if (now() - started > limits.deadlineMs) return void (stopped ??= "deadline");
      if (next >= limits.maxQueries) return void (stopped ??= "budget");
      const idx = next++;
      const q = queries[idx]!;
      if (gaveUp.has(q.language)) continue;
      asked++;
      const outcome = await askOnce(q);
      if (outcome === TIMEOUT) {
        timeouts++;
        const n = (inARow.get(q.language) ?? 0) + 1;
        inARow.set(q.language, n);
        if (n >= limits.maxTimeoutsInARow) gaveUp.add(q.language);
        continue;
      }
      inARow.set(q.language, 0);
      if (outcome === FAILED) continue;
      doneAt[idx] = seq++;
      if (outcome.length) {
        answered++;
        languages.add(q.language);
        if (!firstAnswerAt.has(q.language)) firstAnswerAt.set(q.language, doneAt[idx]!);
      }
      slots[idx] = { file: q.file, line: q.line, column: q.column, targets: outcome };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limits.concurrency, queries.length)) }, worker));

  for (let idx = 0; idx < slots.length; idx++) {
    const slot = slots[idx];
    const q = queries[idx]!;
    const first = firstAnswerAt.get(q.language);
    if (!slot || slot.targets.length || first === undefined || doneAt[idx]! > first) continue;
    if (stopped === "cancelled" || isCancelled() || now() - started > limits.deadlineMs) break;
    retried++;
    const outcome = await askOnce(q);
    if (outcome === TIMEOUT || outcome === FAILED || outcome.length === 0) continue;
    answered++;
    slot.targets = outcome;
  }
  return {
    answers: slots.filter((a): a is DefinitionAnswer => a !== undefined),
    asked,
    answered,
    timeouts,
    gaveUp: [...gaveUp],
    ...(stopped ? { stopped } : {}),
    languages: [...languages].sort(),
    retried,
  };
}

/**
 * While a pass runs, ClarifyDoc's own definition and reference providers
 * stay quiet — `executeDefinitionProvider` asks every provider, and the pass
 * must hear the language servers, never the analysis answering itself.
 */
let activePasses = 0;
export function editorPassActive(): boolean {
  return activePasses > 0;
}
export async function withEditorPass<T>(fn: () => Promise<T>): Promise<T> {
  activePasses++;
  try {
    return await fn();
  } finally {
    activePasses--;
  }
}
