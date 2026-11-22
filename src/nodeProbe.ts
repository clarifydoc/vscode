/**
 * Whether `node` runs, remembered across windows: every window start asked it
 * with `node --version`, a process spawned for an answer that does not change
 * until the settings or the installed analyzer do. vscode-free (a plain
 * key/value store stands in for the extension's global state).
 */
export interface Memory {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

const SLOT = "clarifydoc.nodeOnPath";

/** What the answer was given for: the analyzer's version, `clarifydoc.cliPath` and `clarifydoc.nodePath`. */
export function nodeProbeKey(bundledVersion: string | undefined, cliPath: string, nodePath: string): string {
  return [bundledVersion ?? "", cliPath, nodePath].join("\n");
}

/** The remembered answer for `key`, else `probe`'s, which is then remembered. */
export async function nodeOnPath(memory: Memory | undefined, key: string, probe: () => Promise<boolean>, said?: (how: "remembered" | "spawned") => void): Promise<boolean> {
  const saved = memory?.get<{ key: string; onPath: boolean }>(SLOT);
  if (saved && saved.key === key) {
    said?.("remembered");
    return saved.onPath;
  }
  const onPath = await probe();
  said?.("spawned");
  await memory?.update(SLOT, { key, onPath });
  return onPath;
}

/** Forget the answer: a setting or the refresh command may have changed what `node` is. */
export async function forgetNodeOnPath(memory: Memory | undefined): Promise<void> {
  await memory?.update(SLOT, undefined);
}
