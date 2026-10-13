import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { pathToFileURL } from "url";
import { resultsDir, summaryPath } from "./paths";
import { AnalysisSummary, summarize } from "./summary";
import { relativeInside } from "./pathUtil";
import { CallMiss, CrossTierData, DataFlow, groupBy } from "./crossTier";
import { TypeGraph, typeGraph } from "./typeGraph";

// ─── Shapes we consume (a loose view of the analyzer's ProjectAnalysis) ──────
export interface FnComplexity {
  functionName: string;
  complexity: number;
  line: number; // 1-based
  endLine?: number;
}
export interface SecurityIssue {
  category: string;
  severity: string; // "low" | "medium" | "high" | "critical" | …
  message: string;
  filePath: string; // project-relative
  line: number; // 1-based
  snippet?: string;
  /** `CWE-89` and the like, when the rule maps to one. */
  cwe?: string;
  /** API routes whose handlers reach this finding (capped by the analyzer). */
  entries?: { route: string; file: string; distance: number; confidence: string }[];
}
export interface RouteInfo {
  httpMethod?: string;
  path: string;
  handler?: string;
  filePath: string;
  line: number;
  kind?: string;
}
export interface SymbolLink {
  sourceFile: string;
  sourceSymbol: string;
  sourceLine: number;
  targetFile: string;
  targetSymbol: string;
  targetLine: number;
  confidence?: string;
  resolvedBy?: string;
  /** Which resolution strategy produced the link (see SymbolLinkStrategy). */
  strategy?: string;
  /** What kind of edge it is (see SymbolLinkRelation). */
  relation?: string;
}
export interface ScreenInfo {
  filePath: string;
  title?: string;
  /** The frontend route the screen is served at, when it has one. */
  routePath?: string;
  /** Screens carry no line of their own; set only when a source gives one. */
  line?: number;
}
/** An import that crosses the layer order, or a team rule (`.clarifydoc/config.json` `rules`). */
export interface LayerViolation {
  sourceFile: string;
  line: number;
  sourceLayer?: string;
  targetFile?: string;
  targetLayer?: string;
  importSpecifier?: string;
  /** The team rule this import breaks; absent for the built-in layer-order check. */
  rule?: string;
  severity?: "error" | "warn";
}

/** What the analyzer judged unreachable (`ProjectAnalysis.deadCode`). */
export interface DeadCode {
  /** Languages whose plugin declares a reachability model — only these are judged. */
  languages: string[];
  judgedFiles: number;
  files: { filePath: string; confidence: string; deadImporters: number; lineCount?: number }[];
  exports: { filePath: string; name: string; kind: string; line: number; usedInFile: boolean }[];
  skippedProjects?: { root: string; files: number; reason: string }[];
}

/** An HTTP call to an API, as the analyzer extracted it (`ProjectAnalysis.apiCalls`). */
export interface ApiCall {
  name: string;
  filePath: string;
  line: number;
  /** App-relative URL as written; `{}` marks holes the analyzer could not read. */
  target?: string;
  targetAlternatives?: string[];
}

/** A call joined to the route that serves it (`ProjectAnalysis.apiRouteLinks`). */
export interface ApiRouteLink {
  /** The calling file and line. */
  source: string;
  sourceLine: number;
  method?: string;
  url: string;
  /** The route's file and line. */
  target: string;
  targetLine: number;
  handler?: string;
  routePath: string;
  sourceProject?: string;
  targetProject?: string;
  /** AMBIGUOUS means `target` is only the first of several candidates. */
  confidence: string;
  matchedVia?: string;
  sourceRole?: "test" | "generated";
}

/** Everything a source file needs, pre-indexed for the providers. Built from
 *  the MCP store's per-file index, so the editor and agents group the same
 *  facts the same way. */
export interface FileFacts {
  /** The functions the analyzer measured (tree-sitter languages only) — not
   *  the file's function list; that is `FileIndex.defs`. */
  complexity: FnComplexity[];
  routes: RouteInfo[];
  security: SecurityIssue[];
  /** Links whose call site is in this file (this file calls out). */
  outbound: SymbolLink[];
  /** Links whose resolved definition is in this file (others call in). */
  inbound: SymbolLink[];
  /** HTTP calls made from this file. */
  apiCalls: ApiCall[];
  /** Calls made here, joined to the routes that serve them. */
  callsRoutes: ApiRouteLink[];
  /** Calls elsewhere that reach a route declared here. */
  servesCalls: ApiRouteLink[];
}

/** A Health sub-section that has data, deep-linkable in the report as
 *  `#health/<id>`. Drives the sidebar's Health drill-down. */
export interface HealthSection {
  id: "patterns" | "security" | "suggestions" | "duplicates" | "layers";
  label: string;
  count: number;
}

export interface ResolvedAnalysis {
  projectRoot?: string;
  health?: { score: number; grade: string };
  /** Health sub-sections with data (report deep-link targets). */
  healthSections: HealthSection[];
  frameworks: { name: string; confidence?: string; detectedVia?: string }[];
  subProjects: { id?: string; name?: string; root?: string }[];
  routes: RouteInfo[];
  screens: ScreenInfo[];
  security: SecurityIssue[];
  layerViolations: LayerViolation[];
  /** Every function across the project, each tagged with its file. */
  hotspots: (FnComplexity & { filePath: string })[];
  /** Per project-relative file → facts. */
  byFile: Map<string, FileFacts>;
  /** What cross-tier navigation joins: screens, data flows, unlinked calls, uncalled routes. */
  crossTier: CrossTierData;
  /** Unreachable files and unused exports, when the analysis judged any language. */
  deadCode?: DeadCode;
  /** Project types' supertypes and subtypes, from the class graph. */
  types: TypeGraph;
  /** The MCP store's own index (entities by name, reach by symbol, …), for
   *  lookups the per-file facts do not cover. */
  store: StoreIndex;
  /** All analyzed file paths (project-relative). */
  files: Set<string>;
}

// ─── Logging (wired by extension.ts; silent until then) ──────────────────────
type Log = (level: "info" | "warn" | "error", message: string) => void;
let log: Log = () => {};

export function setAnalysisLog(fn: Log): void {
  log = fn;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Lazy load of the bundled analyzer's summary reader ──────────────────────
/** `loadReportSummary` reads `project-summary.json`, denormalizes it and merges
 *  a current `lsp-enhancement.json` — the same object the MCP server and the
 *  report read — and `buildIndex` groups it by file the way the MCP server
 *  does, so the editor never disagrees with either. */
/** The store's per-file index, typed by the fields read here. */
export interface StoreIndex {
  byFile: Map<string, any>;
  entitiesByName: Map<string, any[]>;
}

/** The two functions read from the bundled analyzer. */
export interface AnalysisReader {
  loadReportSummary(dir: string): Promise<any>;
  buildIndex(project: any): StoreIndex;
}
let readerPromise: Promise<AnalysisReader | undefined> | undefined;

function loadReader(context: vscode.ExtensionContext): Promise<AnalysisReader | undefined> {
  if (readerPromise) return readerPromise;
  const indexPath = path.join(context.extensionPath, "clarifydoc", "dist", "index.js");
  const pending: Promise<AnalysisReader | undefined> = import(pathToFileURL(indexPath).href).then(
    (m) => {
      if (typeof m.loadReportSummary === "function" && typeof m.buildIndex === "function") return m as AnalysisReader;
      log("error", `[analysis] ${indexPath} lacks loadReportSummary/buildIndex — the bundled analyzer is too old`);
      return undefined;
    },
    (err) => {
      log("error", `[analysis] could not load the bundled analyzer (${indexPath}): ${errorText(err)}`);
      return undefined;
    },
  );
  // A failed load is not remembered: the next summary read tries again.
  readerPromise = pending;
  void pending.then((r) => {
    if (!r && readerPromise === pending) readerPromise = undefined;
  });
  return pending;
}

// ─── Per-folder cache keyed by the summary's mtime ───────────────────────────
const cache = new Map<string, { mtimeMs: number; loaded: Promise<LoadedSummary | undefined> }>();

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function hasLine<T extends { line?: unknown }>(x: T): x is T & { line: number } {
  return num(x?.line) !== undefined;
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** The store's facts for one file, in the shapes the views read. */
function fileFacts(f: any): FileFacts {
  const complexity: FnComplexity[] = [];
  for (const fn of arr<any>(f.complexity?.functions)) {
    if (typeof fn?.functionName !== "string" || !hasLine(fn)) continue;
    complexity.push({ functionName: fn.functionName, complexity: num(fn.complexity) ?? 0, line: fn.line, endLine: num(fn.endLine) });
  }
  return {
    complexity,
    routes: arr<RouteInfo>(f.routes).filter(hasLine),
    security: arr<SecurityIssue>(f.security).filter(hasLine),
    outbound: arr<SymbolLink>(f.outbound),
    inbound: arr<SymbolLink>(f.inbound),
    apiCalls: arr<ApiCall>(f.apiCalls).filter(hasLine),
    callsRoutes: arr<ApiRouteLink>(f.callsRoutes),
    servesCalls: arr<ApiRouteLink>(f.servesCalls),
  };
}

/** Index a loaded (denormalized) project summary for the views and providers. */
export function indexProject(p: any, buildIndex: AnalysisReader["buildIndex"]): ResolvedAnalysis {
  const store = buildIndex(p);
  const byFile = new Map<string, FileFacts>();
  for (const [file, f] of store.byFile) byFile.set(file, fileFacts(f));

  const files = new Set<string>(Array.isArray(p.files) ? p.files.filter((x: unknown) => typeof x === "string") : []);

  const hotspots: (FnComplexity & { filePath: string })[] = [];
  for (const [filePath, f] of byFile) {
    for (const fn of f.complexity) hotspots.push({ ...fn, filePath });
  }
  hotspots.sort((a, b) => b.complexity - a.complexity);

  const routes: RouteInfo[] = arr<RouteInfo>(p.routeMap).filter((r) => typeof r?.filePath === "string" && hasLine(r));
  const security: SecurityIssue[] = arr<SecurityIssue>(p.securityIssues).filter(
    (s) => typeof s?.filePath === "string" && hasLine(s),
  );

  const screens: ScreenInfo[] = (p.screens ?? [])
    .filter((s: any) => typeof s?.filePath === "string")
    .map((s: any) => ({
      filePath: s.filePath,
      title: typeof s.name === "string" ? s.name : undefined,
      routePath: typeof s.routePath === "string" ? s.routePath : undefined,
    }));

  const layerViolations: LayerViolation[] = [];
  for (const v of p.layerViolations ?? []) {
    if (typeof v?.sourceFile !== "string" || num(v.line) === undefined) continue;
    layerViolations.push({
      sourceFile: v.sourceFile,
      line: v.line,
      sourceLayer: v.sourceLayer,
      targetFile: v.targetFile,
      targetLayer: v.targetLayer,
      importSpecifier: v.importSpecifier,
      rule: v.rule,
      severity: v.severity === "warn" || v.severity === "error" ? v.severity : undefined,
    });
  }

  const frameworks = (p.detectedFrameworks ?? []).map((f: any) =>
    typeof f === "string" ? { name: f } : { name: f?.name ?? String(f), confidence: f?.confidence, detectedVia: f?.detectedVia },
  );

  // Health sub-sections that carry data, mirroring the report's Health tab so the
  // sidebar can deep-link into each (`#health/<id>`). Security & layer violations
  // reuse the arrays already built above; the rest are counted from the payload.
  const arrLen = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
  const healthSections: HealthSection[] = (
    [
      { id: "patterns", label: "Patterns", count: arrLen(p.patterns) },
      { id: "security", label: "Security", count: security.length },
      { id: "suggestions", label: "Suggestions", count: arrLen(p.suggestions) },
      { id: "duplicates", label: "Duplicates", count: arrLen(p.duplicates) },
      { id: "layers", label: "Layer violations", count: layerViolations.length },
    ] as HealthSection[]
  ).filter((s) => s.count > 0);

  const stats = p.apiRouteLinkStats ?? {};
  const crossTier: CrossTierData = {
    byFile,
    screensByFile: groupBy(screens, (sc) => sc.filePath),
    flowsByEntryFile: groupBy(arr<DataFlow>(p.dataFlows), (f) => (typeof f?.entryFile === "string" ? f.entryFile : undefined)),
    missesByFile: groupBy(arr<CallMiss>(stats.misses), (m) => (typeof m?.file === "string" ? m.file : undefined)),
    uncalled: new Set(arr<{ file: string; line: number }>(stats.uncalled).map((u) => `${u.file}:${u.line}`)),
  };

  return {
    projectRoot: p.projectRoot,
    health: p.healthScore ? { score: p.healthScore.score, grade: p.healthScore.grade } : undefined,
    healthSections,
    frameworks,
    subProjects: (p.subProjects ?? []).map((s: any) => ({ id: s.id, name: s.name, root: s.root })),
    routes,
    screens,
    security,
    layerViolations,
    hotspots,
    byFile,
    crossTier,
    types: typeGraph(p.classGraph),
    deadCode: p.deadCode && Array.isArray(p.deadCode.files) && Array.isArray(p.deadCode.exports) ? p.deadCode : undefined,
    store,
    files,
  };
}

interface LoadedSummary {
  summary: AnalysisSummary;
  /** Undefined when the bundled analyzer cannot be loaded or the summary cannot be indexed. */
  analysis?: ResolvedAnalysis;
}

async function parseSummary(context: vscode.ExtensionContext, sp: string): Promise<LoadedSummary | undefined> {
  const reader = await loadReader(context);
  let project: any;
  try {
    // Without the bundled reader the headline counts still show: every count
    // is an array length, which the stored encoding does not change.
    project = reader ? await reader.loadReportSummary(path.dirname(sp)) : JSON.parse(await fs.readFile(sp, "utf8"));
  } catch (err) {
    // A summary caught mid-write fails to parse; loadSummaryFile retries it.
    log("warn", `[analysis] could not read ${sp}: ${errorText(err)}`);
    return undefined;
  }
  let analysis: ResolvedAnalysis | undefined;
  if (reader) {
    try {
      analysis = indexProject(project, reader.buildIndex);
    } catch (err) {
      log("error", `[analysis] could not index ${sp}: ${errorText(err)}`);
    }
  }
  return { summary: summarize(project), analysis };
}

/**
 * Read a folder's summary once per version and share it. Every view and
 * provider asks at the same moment — after an analysis, the tree, status bar,
 * diagnostics and each visible editor's CodeLens — and a large project's
 * summary is hundreds of MB that JSON.parse holds the extension host for, so
 * the in-flight load is what is cached, not just its result.
 */
function loadSummaryFile(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
): Promise<LoadedSummary | undefined> {
  const sp = summaryPath(context, folder);
  return fs.stat(sp).then(
    ({ mtimeMs }) => {
      const hit = cache.get(sp);
      if (hit && hit.mtimeMs === mtimeMs) return hit.loaded;
      const loaded = parseSummary(context, sp);
      const entry = { mtimeMs, loaded };
      cache.set(sp, entry);
      // A failed read (a summary caught mid-write) is retried on the next ask.
      void loaded.then((l) => {
        if (!l && cache.get(sp) === entry) cache.delete(sp);
      });
      return loaded;
    },
    () => {
      cache.delete(sp);
      return undefined;
    },
  );
}

/**
 * Load and resolve the latest analysis for a folder — path-based, line-bearing
 * data suitable for diagnostics / CodeLens / the sidebar. Returns undefined when
 * there is no analysis yet (or the bundled analyzer cannot be loaded).
 * Cached by the summary's mtime, so repeated provider calls are cheap and a
 * re-analysis is picked up automatically.
 */
export async function loadAnalysis(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
): Promise<ResolvedAnalysis | undefined> {
  return (await loadSummaryFile(context, folder))?.analysis;
}

/** The headline numbers of the latest analysis, from the same single read. */
export async function loadSummary(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
): Promise<AnalysisSummary | undefined> {
  return (await loadSummaryFile(context, folder))?.summary;
}

// ─── Per-file definitions and links ──────────────────────────────────────────

/**
 * A function, method or class defined in one file, spelled the way
 * symbolLinks spell it: `fn`, `Class.method`, `Class`.
 */
export interface Definition {
  symbol: string;
  kind: "function" | "class";
  line: number; // 1-based
  /** Only where the analyzer measured it: complexity needs a syntax tree, so
   *  the regex-extracted languages (Ruby, Go, Rust, …) never have one. */
  complexity?: number;
}

/** The other end of a link: a caller's call site, or a callee's definition. */
export interface LinkEnd {
  file: string;
  line: number;
  symbol: string;
}

/** What the lens, hover and caller/callee picker read for one file. */
export interface FileIndex {
  defs: Definition[];
  /** symbol → its callers, one per call site. */
  callers: Map<string, LinkEnd[]>;
  /** symbol → its callees, one per definition. */
  callees: Map<string, LinkEnd[]>;
}

/**
 * Every definition in a file, from the per-file JSON the analyzer writes next
 * to the summary, with measured complexity attached. The summary itself lists
 * functions only inside `complexity`, which is tree-sitter-only — reading
 * definitions from there left every regex-extracted file without a single lens
 * or hover. A measured function with no matching definition (no per-file JSON,
 * say) is kept, so nothing the summary alone could show is lost.
 */
function definitionsOf(raw: any, measured: FnComplexity[]): Definition[] {
  const defs: Definition[] = [];
  for (const fn of Array.isArray(raw?.functions) ? raw.functions : []) {
    // `<setup>` and kin stand for top-level code, not something written as a function.
    if (typeof fn?.name === "string" && !fn.name.startsWith("<") && num(fn.line) !== undefined) {
      defs.push({ symbol: fn.name, kind: "function", line: fn.line });
    }
  }
  // A method can be credited to more than one owner (Ruby lists a nested
  // class's methods under its module too). It is one definition; keep the
  // innermost owner, the one that starts last.
  const methods = new Map<string, { def: Definition; ownerLine: number }>();
  for (const cls of Array.isArray(raw?.classes) ? raw.classes : []) {
    if (typeof cls?.name !== "string" || num(cls.line) === undefined) continue;
    defs.push({ symbol: cls.name, kind: "class", line: cls.line });
    for (const m of Array.isArray(cls.methods) ? cls.methods : []) {
      if (typeof m?.name !== "string" || num(m.line) === undefined) continue;
      const key = `${m.line}:${m.name}`;
      const prev = methods.get(key);
      if (prev && prev.ownerLine >= cls.line) continue;
      methods.set(key, { def: { symbol: `${cls.name}.${m.name}`, kind: "function", line: m.line }, ownerLine: cls.line });
    }
  }
  for (const { def } of methods.values()) defs.push(def);

  const byKey = new Map(defs.map((d) => [`${d.line}:${d.symbol}`, d]));
  for (const fn of measured) {
    const def = byKey.get(`${fn.line}:${fn.functionName}`);
    if (def) def.complexity = fn.complexity;
    else defs.push({ symbol: fn.functionName, kind: "function", line: fn.line, complexity: fn.complexity });
  }
  return defs.sort((a, b) => a.line - b.line);
}

/** Group links by the symbol at this file's end, one row per far end — the rows
 *  the picker lists, so a lens's count matches it. */
function indexLinks(
  links: SymbolLink[],
  near: (l: SymbolLink) => string,
  far: (l: SymbolLink) => LinkEnd,
): Map<string, LinkEnd[]> {
  const out = new Map<string, LinkEnd[]>();
  const seen = new Set<string>();
  for (const l of links) {
    const symbol = near(l);
    const end = far(l);
    const key = `${symbol}\0${end.file}:${end.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = out.get(symbol);
    if (rows) rows.push(end);
    else out.set(symbol, [end]);
  }
  return out;
}

async function buildFileIndex(perFileJson: string, facts: FileFacts): Promise<FileIndex> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(perFileJson, "utf8"));
  } catch {
    raw = undefined; // no per-file JSON: the measured functions still show
  }
  return {
    defs: definitionsOf(raw, facts.complexity),
    callers: indexLinks(facts.inbound, (l) => l.targetSymbol, (l) => ({ file: l.sourceFile, line: l.sourceLine, symbol: l.sourceSymbol })),
    callees: indexLinks(facts.outbound, (l) => l.sourceSymbol, (l) => ({ file: l.targetFile, line: l.targetLine, symbol: l.targetSymbol })),
  };
}

// Keyed on the summary's FileFacts: a re-analysis writes a new summary, which
// makes new FileFacts, so the index rebuilds and the old one goes with the old
// summary. The analyzer writes every per-file JSON before the summary, so the
// summary's mtime covers them too — no per-hover stat of the per-file JSON.
const fileIndexes = new WeakMap<FileFacts, Promise<FileIndex>>();

/** The file's definitions and links, built once per file per analysis. */
export function loadFileIndex(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
  rel: string,
  facts: FileFacts,
): Promise<FileIndex> {
  let idx = fileIndexes.get(facts);
  if (!idx) {
    idx = buildFileIndex(path.join(resultsDir(context, folder), `${rel}.json`), facts);
    fileIndexes.set(facts, idx);
  }
  return idx;
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * A definition's caller/callee commands — references, for a class — worded
 * once for both the CodeLens and the hover card.
 */
export function linkCommands(idx: FileIndex, def: Definition, uriArg: string): vscode.Command[] {
  const callers = idx.callers.get(def.symbol)?.length ?? 0;
  const out: vscode.Command[] = [];
  if (def.kind === "class") {
    // Who uses the class: `new X`, `extends X`, type positions.
    if (callers > 0) out.push({ title: `$(references) ${count(callers, "reference")}`, command: "clarifydoc.showCallers", arguments: [uriArg, def.symbol] });
    return out;
  }
  const callees = idx.callees.get(def.symbol)?.length ?? 0;
  if (callers > 0) out.push({ title: `$(arrow-left) ${count(callers, "caller")}`, command: "clarifydoc.showCallers", arguments: [uriArg, def.symbol] });
  if (callees > 0) out.push({ title: `$(arrow-right) ${count(callees, "callee")}`, command: "clarifydoc.showCallees", arguments: [uriArg, def.symbol] });
  return out;
}

/** Project-relative, forward-slashed path of a document within a folder (or undefined). */
export function relPathOf(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string | undefined {
  return relativeInside(folder.uri.fsPath, uri.fsPath);
}
