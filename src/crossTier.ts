/**
 * The joins behind cross-tier navigation: a call to the route that serves it,
 * a route to its callers, the screens those callers sit under, and the tables
 * the route reaches. Pure functions over the indexed analysis, no `vscode`,
 * so they are unit-tested against fixture summaries.
 *
 * Everything here reads links the analyzer already made; nothing is guessed.
 * An AMBIGUOUS link names only the first of several routes, so it is never
 * offered as a destination — only described.
 */
import type { ApiCall, ApiRouteLink, FileFacts, RouteInfo, ScreenInfo } from "./analysisData";

/** A call that reached no route (`apiRouteLinkStats.misses`). */
export interface CallMiss {
  file: string;
  line: number;
  method?: string | null;
  url: string;
  reason: string;
  /** The routes that do serve the path, refused for `reason` (the backend accepts PUT). */
  existing?: Array<{ method: string | null; path: string; file: string; line: number }>;
}

/** A request body that disagrees with the route it reaches (`ProjectAnalysis.contractFindings`). */
export interface ContractFinding {
  file: string;
  line: number;
  method?: string | null;
  url: string;
  route: { file: string; line: number; path: string };
  kind: "missing-field" | "unknown-field" | "type-mismatch" | "unknown-response-field";
  field: string;
  expected?: string;
  actual?: string;
}

/** A route's path from entry to effect (`ProjectAnalysis.dataFlows`). */
export interface DataFlow {
  /** `command`: an entry point that is not a route — a CLI command, an editor command, an MCP tool. */
  entryKind: "route" | "screen" | "command";
  entryLabel: string;
  entryFile: string;
  effect: string;
  resource: string;
  distance: number;
  confidence: string;
  via?: { file: string; symbol: string; line?: number }[];
}

/** What the joins need from the indexed analysis. */
export interface CrossTierData {
  byFile: Map<string, FileFacts>;
  /** Screens keyed by the file that defines them. */
  screensByFile: Map<string, ScreenInfo[]>;
  /** Data flows keyed by the file of their entry (the route's file). */
  flowsByEntryFile: Map<string, DataFlow[]>;
  /** Unlinked calls keyed by their file. */
  missesByFile: Map<string, CallMiss[]>;
  /** Request-contract findings, by calling file. */
  contractsByFile?: Map<string, ContractFinding[]>;
  /** `file:line` of routes nothing calls (only sub-projects some caller calls). */
  uncalled: Set<string>;
  /** Exact number of uncalled routes — the listed ones are capped. */
  uncalledCount?: number;
}

// ─── Calls → routes ───────────────────────────────────────────────────────────

/** The links of the calls on one line of a file (1-based). */
export function linksAtLine(facts: FileFacts, line: number): ApiRouteLink[] {
  return facts.callsRoutes.filter((l) => l.sourceLine === line);
}

/** The api calls written on one line (1-based). */
export function callsAtLine(facts: FileFacts, line: number): ApiCall[] {
  return facts.apiCalls.filter((c) => c.line === line);
}

/** The links F12 may jump through: one route each, never an ambiguous pick. */
export function navigableLinks(links: ApiRouteLink[]): ApiRouteLink[] {
  return links.filter((l) => l.confidence !== "AMBIGUOUS");
}

/** Why the calls on a line reached no route, if the analyzer recorded it. */
export function missesAtLine(data: CrossTierData, file: string, line: number): CallMiss[] {
  return (data.missesByFile.get(file) ?? []).filter((m) => m.line === line);
}

/**
 * Where the URL of a call is written on its line, as a column range — so F12
 * answers on the URL and leaves the rest of the line to the language's own
 * definitions. Each candidate (the call's target, the link's URL) is cut at
 * its first hole (`{}`, `${…}`, `:param`), then tried with leading path
 * segments dropped, since a client's base (`/api`) is often not written at
 * the call. Undefined when no candidate is on the line.
 */
export function urlRange(lineText: string, candidates: (string | undefined)[]): { start: number; end: number } | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const stat = candidate.split(/\$\{|\{|\/:/)[0].replace(/\/+$/, "");
    const segments = stat.split("/").filter(Boolean);
    for (let drop = 0; drop < segments.length; drop++) {
      const tail = "/" + segments.slice(drop).join("/");
      if (tail.length < 2) break;
      const at = lineText.indexOf(tail);
      if (at < 0) continue;
      // Extend over the rest of the literal: up to the closing quote.
      const close = /["'`]/.exec(lineText.slice(at));
      const end = close ? at + close.index : at + tail.length;
      return { start: at, end };
    }
  }
  return undefined;
}

// ─── Routes → callers, screens, tables ───────────────────────────────────────

/** The links that reach one route declared in this file. */
export function callersOf(facts: FileFacts, route: RouteInfo): ApiRouteLink[] {
  return facts.servesCalls.filter(
    (l) =>
      l.targetLine === route.line &&
      (!l.method || !route.httpMethod || l.method.toUpperCase() === route.httpMethod.toUpperCase()),
  );
}

/** Whether the analyzer saw this route and found nothing calling it. */
export function isUncalled(data: CrossTierData, route: RouteInfo): boolean {
  return data.uncalled.has(`${route.filePath}:${route.line}`);
}

/** How many call-graph levels to climb from a call site looking for a screen. */
const SCREEN_DEPTH = 6;
/** Bound on the functions visited per route. */
const SCREEN_VISITS = 2000;

/**
 * The screens a route's callers sit under: the nearest file that is a screen
 * on each call path upward — the calling function's own file, or that of a
 * function calling it, up to `SCREEN_DEPTH` levels. Climbs the call links the analyzer resolved (including
 * dependency-injected ones), starting from the function that contains each
 * call — the `http` link's source.
 */
export function screensReaching(data: CrossTierData, callers: ApiRouteLink[]): ScreenInfo[] {
  const found = new Map<string, ScreenInfo>();
  const seen = new Set<string>();
  let frontier: { file: string; symbol?: string }[] = [];
  for (const link of callers) {
    const http = data.byFile
      .get(link.source)
      ?.outbound.find((s) => s.relation === "http" && s.sourceLine === link.sourceLine);
    frontier.push({ file: link.source, symbol: http?.sourceSymbol });
  }
  for (let depth = 0; depth <= SCREEN_DEPTH && frontier.length > 0 && seen.size < SCREEN_VISITS; depth++) {
    const next: { file: string; symbol?: string }[] = [];
    for (const node of frontier) {
      const key = `${node.file}\0${node.symbol ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // The nearest screen is the answer for this path: climbing past it
      // would credit the app shell (the router, `main`) with every endpoint.
      const screens = data.screensByFile.get(node.file);
      if (screens?.length) {
        for (const screen of screens) found.set(`${screen.filePath}\0${screen.title}`, screen);
        continue;
      }
      if (!node.symbol) continue;
      for (const l of data.byFile.get(node.file)?.inbound ?? []) {
        if (l.targetSymbol === node.symbol && l.relation !== "http") next.push({ file: l.sourceFile, symbol: l.sourceSymbol });
      }
    }
    frontier = next;
  }
  return [...found.values()];
}

/** What a route reads and writes, from its data flows: resource names by kind. */
export interface RouteData {
  reads: string[];
  writes: string[];
  /** Effects whose direction the analyzer could not tell. */
  touches: string[];
  /** The flows themselves, shortest first, for showing a path. */
  flows: DataFlow[];
}

export function routeData(data: CrossTierData, route: RouteInfo): RouteData {
  const label = [route.httpMethod, route.path].filter(Boolean).join(" ");
  const flows = (data.flowsByEntryFile.get(route.filePath) ?? [])
    .filter((f) => f.entryKind === "route" && f.entryLabel === label && f.effect.startsWith("db"))
    .sort((a, b) => a.distance - b.distance);
  const pick = (effect: string) => [...new Set(flows.filter((f) => f.effect === effect).map((f) => f.resource))].sort();
  return { reads: pick("db-read"), writes: pick("db-write"), touches: pick("db"), flows };
}

/** One line for a route: `3 callers · 2 screens · writes orders · reads users`. */
export function describeRoute(callerCount: number, screens: ScreenInfo[], d: RouteData, uncalled: boolean): string {
  const parts: string[] = [];
  if (callerCount > 0) parts.push(`${callerCount} caller${callerCount === 1 ? "" : "s"}`);
  else if (uncalled) parts.push("no caller found");
  if (screens.length > 0) parts.push(`${screens.length} screen${screens.length === 1 ? "" : "s"}`);
  if (d.writes.length) parts.push(`writes ${d.writes.join(", ")}`);
  if (d.reads.length) parts.push(`reads ${d.reads.join(", ")}`);
  if (d.touches.length) parts.push(`uses ${d.touches.join(", ")}`);
  return parts.join(" · ");
}

/** Group a list by a key. */
export function groupBy<T>(items: Iterable<T>, key: (item: T) => string | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined) continue;
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

