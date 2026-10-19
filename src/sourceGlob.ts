/**
 * A glob matching every file the analyzer reads, built from what
 * `clarifydoc detect --json` reports: its extensions (`.ts` → `*.ts`) and its
 * extension-less file names (`Jenkinsfile`). Names are matched both as
 * reported and capitalized, since a glob is case-sensitive on most file
 * systems and conventions differ (`routes`, `Jenkinsfile`).
 *
 * Several globs, one per watcher: VS Code's file watcher delivers no event at
 * all for nested braces (`{**\/*.{ts},**\/{Jenkinsfile}}`), which is how the
 * save loop went silent once named files joined the list.
 */
export function sourceGlobFrom(detected: { analyzableExtensions?: unknown; namedFiles?: unknown }): string[] | undefined {
  const exts = strings(detected.analyzableExtensions)
    .map((e) => e.replace(/^\./, ""))
    .filter((e) => /^[\w.+-]+$/.test(e));
  const names = new Set<string>();
  for (const n of strings(detected.namedFiles)) {
    if (!/^[\w.+-]+$/.test(n)) continue;
    names.add(n);
    names.add(n[0].toUpperCase() + n.slice(1));
  }
  if (exts.length === 0) return undefined;
  const parts = [`**/*.{${exts.join(",")}}`];
  if (names.size) parts.push(`**/{${[...names].sort().join(",")}}`);
  return parts;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}
