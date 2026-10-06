import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { pathToFileURL } from "url";
import { summaryPath } from "./paths";

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
  line?: number;
}
export interface LayerViolation {
  filePath?: string;
  from?: string;
  to?: string;
  message?: string;
  line?: number;
}

/** Everything a source file needs, pre-indexed for the providers. */
export interface FileFacts {
  functions: FnComplexity[];
  routes: RouteInfo[];
  security: SecurityIssue[];
  /** Links whose call site is in this file (this file calls out). */
  outbound: SymbolLink[];
  /** Links whose resolved definition is in this file (others call in). */
  inbound: SymbolLink[];
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
  /** All analyzed file paths (project-relative). */
  files: Set<string>;
}

// ─── Lazy, one-time load of the bundled analyzer's denormalizer ──────────────
type Denormalize = (raw: unknown) => any;
let denormPromise: Promise<Denormalize | undefined> | undefined;

function loadDenormalizer(context: vscode.ExtensionContext): Promise<Denormalize | undefined> {
  if (denormPromise) return denormPromise;
  const indexPath = path.join(context.extensionPath, "clarifydoc", "dist", "index.js");
  denormPromise = import(pathToFileURL(indexPath).href)
    .then((m) => (typeof m.denormalizeProject === "function" ? (m.denormalizeProject as Denormalize) : undefined))
    .catch(() => undefined);
  return denormPromise;
}

// ─── Per-folder cache keyed by the summary's mtime ───────────────────────────
const cache = new Map<string, { mtimeMs: number; data: ResolvedAnalysis }>();

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function index(p: any): ResolvedAnalysis {
  const byFile = new Map<string, FileFacts>();
  const facts = (f: string): FileFacts => {
    let e = byFile.get(f);
    if (!e) { e = { functions: [], routes: [], security: [], outbound: [], inbound: [] }; byFile.set(f, e); }
    return e;
  };

  const files = new Set<string>(Array.isArray(p.files) ? p.files.filter((x: unknown) => typeof x === "string") : []);

  const hotspots: (FnComplexity & { filePath: string })[] = [];
  for (const fc of p.complexity ?? []) {
    const filePath = fc.filePath;
    if (typeof filePath !== "string") continue;
    for (const fn of fc.functions ?? []) {
      if (typeof fn?.functionName !== "string" || num(fn.line) === undefined) continue;
      const entry: FnComplexity = {
        functionName: fn.functionName,
        complexity: num(fn.complexity) ?? 0,
        line: fn.line,
        endLine: num(fn.endLine),
      };
      facts(filePath).functions.push(entry);
      hotspots.push({ ...entry, filePath });
    }
  }
  hotspots.sort((a, b) => b.complexity - a.complexity);

  const routes: RouteInfo[] = [];
  for (const r of p.routeMap ?? []) {
    if (typeof r?.filePath !== "string" || num(r.line) === undefined) continue;
    const route: RouteInfo = {
      httpMethod: r.httpMethod,
      path: r.path ?? "",
      handler: r.handler,
      filePath: r.filePath,
      line: r.line,
      kind: r.kind,
    };
    routes.push(route);
    facts(route.filePath).routes.push(route);
  }

  const security: SecurityIssue[] = [];
  for (const s of p.securityIssues ?? []) {
    if (typeof s?.filePath !== "string" || num(s.line) === undefined) continue;
    const issue: SecurityIssue = {
      category: s.category ?? "security",
      severity: String(s.severity ?? "medium"),
      message: s.message ?? s.category ?? "Security issue",
      filePath: s.filePath,
      line: s.line,
      snippet: s.snippet,
    };
    security.push(issue);
    facts(issue.filePath).security.push(issue);
  }

  for (const l of p.symbolLinks ?? []) {
    if (typeof l?.sourceFile !== "string" || typeof l?.targetFile !== "string") continue;
    const link: SymbolLink = {
      sourceFile: l.sourceFile,
      sourceSymbol: l.sourceSymbol ?? "",
      sourceLine: num(l.sourceLine) ?? 0,
      targetFile: l.targetFile,
      targetSymbol: l.targetSymbol ?? "",
      targetLine: num(l.targetLine) ?? 0,
      confidence: l.confidence,
      resolvedBy: l.resolvedBy,
      strategy: l.strategy,
      relation: l.relation,
    };
    facts(link.sourceFile).outbound.push(link);
    facts(link.targetFile).inbound.push(link);
  }

  const screens: ScreenInfo[] = (p.screens ?? [])
    .filter((s: any) => typeof s?.filePath === "string")
    .map((s: any) => ({ filePath: s.filePath, title: s.title ?? s.name, line: num(s.line) }));

  const layerViolations: LayerViolation[] = (p.layerViolations ?? []).map((v: any) => ({
    filePath: v.filePath ?? v.file,
    from: v.from ?? v.fromLayer,
    to: v.to ?? v.toLayer,
    message: v.message ?? v.reason,
    line: num(v.line),
  }));
  for (const v of layerViolations) {
    if (v.filePath) facts(v.filePath); // ensure the file bucket exists
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
    files,
  };
}

/**
 * Load and resolve the latest analysis for a folder — path-based, line-bearing
 * data suitable for diagnostics / CodeLens / the sidebar. Returns undefined when
 * there is no analysis yet (or the bundled denormalizer can't be loaded).
 * Cached by the summary's mtime, so repeated provider calls are cheap and a
 * re-analysis is picked up automatically.
 */
export async function loadAnalysis(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
): Promise<ResolvedAnalysis | undefined> {
  const sp = summaryPath(context, folder);
  let mtimeMs: number;
  try {
    mtimeMs = (await fs.stat(sp)).mtimeMs;
  } catch {
    cache.delete(sp);
    return undefined;
  }
  const hit = cache.get(sp);
  if (hit && hit.mtimeMs === mtimeMs) return hit.data;

  const denorm = await loadDenormalizer(context);
  if (!denorm) return undefined;

  let data: ResolvedAnalysis;
  try {
    const raw = JSON.parse(await fs.readFile(sp, "utf8"));
    data = index(denorm(raw));
  } catch {
    return undefined;
  }
  cache.set(sp, { mtimeMs, data });
  return data;
}

// ─── Per-file definitions and links ──────────────────────────────────────────

/** A function or method in one file, spelled the way symbolLinks spell it: `fn`, `Class.method`. */
export interface Definition {
  symbol: string;
  line: number; // 1-based
  complexity: number;
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

// Keyed on the summary's FileFacts: a re-analysis writes a new summary, which
// makes new FileFacts, so the index rebuilds and the old one goes with the old
// summary.
const fileIndexes = new WeakMap<FileFacts, FileIndex>();

/** The file's definitions and links, built once per file per analysis. */
export function fileIndex(facts: FileFacts): FileIndex {
  let idx = fileIndexes.get(facts);
  if (!idx) {
    idx = {
      defs: facts.functions.map((fn) => ({ symbol: fn.functionName, line: fn.line, complexity: fn.complexity })),
      callers: indexLinks(facts.inbound, (l) => l.targetSymbol, (l) => ({ file: l.sourceFile, line: l.sourceLine, symbol: l.sourceSymbol })),
      callees: indexLinks(facts.outbound, (l) => l.sourceSymbol, (l) => ({ file: l.targetFile, line: l.targetLine, symbol: l.targetSymbol })),
    };
    fileIndexes.set(facts, idx);
  }
  return idx;
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** A definition's caller/callee commands, worded once for both the CodeLens and the hover card. */
export function linkCommands(idx: FileIndex, def: Definition, uriArg: string): vscode.Command[] {
  const callers = idx.callers.get(def.symbol)?.length ?? 0;
  const callees = idx.callees.get(def.symbol)?.length ?? 0;
  const out: vscode.Command[] = [];
  if (callers > 0) out.push({ title: `$(arrow-left) ${count(callers, "caller")}`, command: "clarifydoc.showCallers", arguments: [uriArg, def.symbol] });
  if (callees > 0) out.push({ title: `$(arrow-right) ${count(callees, "callee")}`, command: "clarifydoc.showCallees", arguments: [uriArg, def.symbol] });
  return out;
}

/** Project-relative, forward-slashed path of a document within a folder (or undefined). */
export function relPathOf(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string | undefined {
  const rel = path.relative(folder.uri.fsPath, uri.fsPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep).join("/");
}
