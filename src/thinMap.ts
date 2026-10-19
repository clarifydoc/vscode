/**
 * What an analysis that "completed" may still have missed: a server
 * framework the project depends on, yet no route; a frontend framework, yet
 * no screen. Said after the run, so an empty Routes list is not read as
 * "this project has no API". Pure — no `vscode` — so it is unit-tested.
 */
import type { DeclaredDependency } from "./analysisData";

export interface ThinMapInput {
  files: number;
  routes: number;
  screens: number;
  packages: readonly DeclaredDependency[];
}

/**
 * Why answers about one file may be incomplete — said where the file is open,
 * so "no callers" there is not read as a fact. Null when the file was read
 * whole and its imports all resolved.
 */
export function thinFileNote(t: { parseRatio?: number; unresolvedImports?: number; totalImports?: number } | undefined): string | null {
  if (!t) return null;
  const parts: string[] = [];
  if (t.parseRatio && t.parseRatio > 0) parts.push(`${Math.max(1, Math.round(t.parseRatio * 100))}% of it is syntax the parser could not follow`);
  if (t.unresolvedImports) {
    const total = t.totalImports ?? t.unresolvedImports;
    parts.push(total === 1 ? "its one relative import resolves to no file" : `${t.unresolvedImports} of its ${total} relative imports resolve${t.unresolvedImports === 1 ? "s" : ""} to no file`);
  }
  if (parts.length === 0) return null;
  return `ClarifyDoc's map is thin here: ${parts.join("; ")}. A missing caller, route or link in this file may be a blind spot, not a fact.`;
}

/** One sentence per gap, naming the dependency that made it a gap. */
export function thinMapNotes(a: ThinMapInput): string[] {
  if (a.files === 0) return ["no source file was analyzed — check clarifydoc.exclude and the folder opened"];
  const prod = a.packages.filter((p) => p.scope !== "dev" && p.used !== false);
  const named = (category: string): string | undefined => {
    const hits = prod.filter((p) => p.category === category).map((p) => p.name);
    return hits.length === 0 ? undefined : hits.slice(0, 2).join(", ") + (hits.length > 2 ? ", …" : "");
  };
  const notes: string[] = [];
  const server = named("framework");
  if (server && a.routes === 0) notes.push(`${server} is a dependency, yet no API route was found`);
  const frontend = named("frontend");
  if (frontend && a.screens === 0) notes.push(`${frontend} is a dependency, yet no screen was found`);
  return notes;
}

/**
 * A prefilled "report a gap" issue: the notes, the detected frameworks and the
 * versions — opened in the browser for the user to read, edit and submit;
 * nothing is sent from the editor. No paths or code are included.
 */
export function gapIssueUrl(notes: readonly string[], frameworks: readonly string[], extensionVersion: string, platform: string): string {
  const title = `Analysis gap: ${notes[0] ?? "missing results"}`;
  const body = [
    "**What the analysis missed**",
    ...notes.map((n) => `- ${n}`),
    "",
    `**Detected frameworks:** ${frameworks.length > 0 ? frameworks.join(", ") : "none"}`,
    `**Extension:** ${extensionVersion} · **OS:** ${platform}`,
    "",
    "**What I expected to see** (a route, screen or file it should have found):",
    "",
  ].join("\n");
  return `https://github.com/clarifydoc/vscode/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
