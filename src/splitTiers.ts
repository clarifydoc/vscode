/**
 * Frontend and backend in different roots of a multi-root workspace
 * (VSCODE 8.5). Each workspace folder is analyzed alone, so a call in one
 * folder never reaches a route in another: the link is simply missing, and
 * nothing says why. This finds the calls one folder could not place that
 * another folder's routes serve — joined by the engine's own route linker,
 * never a path guess here — so the extension can say so and offer the one
 * analysis that would link them: the folders' common parent.
 *
 * Pure, no `vscode`: unit-tested against hand-built folders.
 */
import * as path from "path";
import type { RouteInfo } from "./analysisData";
import type { CallMiss } from "./crossTier";

export interface TierFolder {
  name: string;
  /** Absolute path of the workspace folder. */
  root: string;
  /** Calls the folder's own analysis could not place (`apiRouteLinkStats.misses`). */
  misses: CallMiss[];
  routes: RouteInfo[];
}

/** The engine's linker, as the bundled analyzer exports it. */
export type RouteLinker = (
  calls: Array<{ kind: "api-call"; name: string; target: string; calls: never[]; line: number; filePath: string }>,
  routes: RouteInfo[],
) => { links: Array<{ source: string; sourceLine: number; url: string; target: string; routePath: string; confidence: string }> };

export interface SplitTier {
  /** The folder whose calls reach no route of its own. */
  caller: string;
  /** The folder whose routes serve them. */
  server: string;
  /** Calls that would link, by distinct call site. */
  calls: number;
  /** A few `METHOD url → route` lines, for the message and the log. */
  examples: string[];
}

/** Only a call nothing in its own folder serves; a refused method or origin is a fact about that folder. */
const placeable = (m: CallMiss) => m.reason === "unmatched";

function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function findSplitTiers(folders: readonly TierFolder[], link: RouteLinker): SplitTier[] {
  const out: SplitTier[] = [];
  for (const caller of folders) {
    const misses = caller.misses.filter(placeable);
    if (misses.length === 0) continue;
    const calls = misses.map((m) => ({
      kind: "api-call" as const,
      // The linker reads the verb off a call named `METHOD url`.
      name: m.method ? `${m.method.toUpperCase()} ${m.url}` : "fetch",
      target: m.url,
      calls: [] as never[],
      line: m.line,
      filePath: m.file,
    }));
    for (const server of folders) {
      // A nested folder is already inside the other's analysis.
      if (server === caller || inside(server.root, caller.root) || inside(caller.root, server.root)) continue;
      if (server.routes.length === 0) continue;
      // An AMBIGUOUS link names a route only as the first of several — still a link the parent would make.
      const links = link(calls, server.routes).links;
      const sites = new Set(links.map((l) => `${l.source}:${l.sourceLine}`));
      if (sites.size === 0) continue;
      out.push({
        caller: caller.name,
        server: server.name,
        calls: sites.size,
        examples: links.slice(0, 3).map((l) => `${l.url} → ${l.routePath} (${l.target})`),
      });
    }
  }
  return out.sort((a, b) => b.calls - a.calls);
}

/**
 * The directory holding every given folder, or undefined when that is the
 * filesystem root or the home directory — analyzing either as one project
 * would read far more than the workspace.
 */
export function commonParent(roots: readonly string[], home: string): string | undefined {
  if (roots.length === 0) return undefined;
  let parent = path.resolve(roots[0]!);
  for (const r of roots.slice(1)) {
    const abs = path.resolve(r);
    while (!inside(abs, parent)) {
      const up = path.dirname(parent);
      if (up === parent) return undefined;
      parent = up;
    }
  }
  if (path.dirname(parent) === parent || path.resolve(home) === parent) return undefined;
  return parent;
}
