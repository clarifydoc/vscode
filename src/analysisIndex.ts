/**
 * Indexing a loaded project summary into what the views and providers read.
 * Pure — no `vscode` — so it runs on a worker thread (summaryWorker.ts) as
 * well as in the extension host.
 */
import { groupBy } from "./crossTier";
import type { CallMiss, ContractFinding, CrossTierData, DataFlow } from "./crossTier";
import { projectTypes, typeGraph, type ProjectTypes } from "./typeGraph";
import type {
  AnalysisReader,
  DeclaredDependency,
  DocDriftFinding,
  FileFacts,
  FileHistory,
  FileTestCoverage,
  FnComplexity,
  HealthSection,
  LayerViolation,
  ResolvedAnalysis,
  RiskVerdict,
  RouteInfo,
  ScreenInfo,
  SecurityIssue,
  SymbolLink,
  ThinFile,
  ApiCall,
  ApiRouteLink,
} from "./analysisData";

/** The files rated high or critical to change. */
export function riskyFilesOf(blast: unknown): Map<string, RiskVerdict> {
  const out = new Map<string, RiskVerdict>();
  for (const b of Array.isArray(blast) ? (blast as Array<{ filePath?: unknown; verdict?: RiskVerdict }>) : []) {
    const v = b.verdict;
    if (typeof b.filePath === "string" && v && (v.level === "high" || v.level === "critical") && typeof v.summary === "string") out.set(b.filePath, v);
  }
  return out;
}

/** `3-5,9` → [[3,5],[9,9]]. */
export function parseLineRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const part of text.split(",")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (m) out.push([Number(m[1]), Number(m[2] ?? m[1])]);
  }
  return out;
}

/** Per-file test coverage, from the analysis's `testCoverage`. */
export function testCoverageOf(raw: unknown): Map<string, FileTestCoverage> {
  const out = new Map<string, FileTestCoverage>();
  const r = raw as { sources?: Array<{ file: string; stale?: boolean }>; files?: Array<{ file: string; total: number; covered: number; uncovered?: string }> } | undefined;
  const sources = (r?.sources ?? []).map((s) => s.file);
  const stale = (r?.sources ?? []).some((s) => s.stale);
  for (const f of r?.files ?? []) {
    if (typeof f?.file !== "string" || !(f.total > 0)) continue;
    out.set(f.file, { total: f.total, covered: f.covered, uncovered: parseLineRanges(f.uncovered ?? ""), sources, stale });
  }
  return out;
}

/** The files `coverage` names: the worst parse errors and the most unresolved imports (each list capped by the analyzer). */
export function thinFilesOf(coverage: unknown): Map<string, ThinFile> {
  const out = new Map<string, ThinFile>();
  const c = coverage as { parseErrors?: { worst?: Array<{ file: string; ratio: number }> }; imports?: { worst?: Array<{ file: string; unresolved: number; total: number }> } } | undefined;
  for (const w of c?.parseErrors?.worst ?? []) {
    if (typeof w?.file === "string" && w.ratio > 0) out.set(w.file, { ...out.get(w.file), parseRatio: w.ratio });
  }
  for (const w of c?.imports?.worst ?? []) {
    if (typeof w?.file === "string" && w.unresolved > 0) out.set(w.file, { ...out.get(w.file), unresolvedImports: w.unresolved, totalImports: w.total });
  }
  return out;
}

export function num(v: unknown): number | undefined {
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

type TestRules = Pick<AnalysisReader, "isTestFile" | "getLanguageForFile" | "ownersOf">;

/** Index a loaded (denormalized) project summary for the views and providers. */
export function indexProject(p: any, buildIndex: AnalysisReader["buildIndex"], testRules?: TestRules): ResolvedAnalysis {
  return reviveIndexed(indexProjectData(p, buildIndex), testRules);
}

/**
 * `indexProject`'s result as plain data, which a worker thread can post back.
 * What needs a closure (the type lookups, the analyzer's test and CODEOWNERS
 * rules) is carried as its input and built by `reviveIndexed`.
 */
export interface IndexedProject {
  analysis: Omit<ResolvedAnalysis, "types" | "isTest" | "hasTests" | "history">;
  classGraph: ProjectTypes;
  history: HistoryData;
}

/** Add what `IndexedProject` carries as input: the type graph, the test predicate and file history. */
export function reviveIndexed(d: IndexedProject, testRules?: TestRules): ResolvedAnalysis {
  return {
    ...d.analysis,
    types: typeGraph(d.classGraph),
    ...testPredicate(d.analysis.files, testRules),
    ...historyOf(d.history, testRules),
  };
}

/** The plain-data half of `indexProject`. */
export function indexProjectData(p: any, buildIndex: AnalysisReader["buildIndex"]): IndexedProject {
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
    contractsByFile: groupBy(arr<ContractFinding>(p.contractFindings), (c) => (typeof c?.file === "string" ? c.file : undefined)),
    uncalled: new Set(arr<{ file: string; line: number }>(stats.uncalled).map((u) => `${u.file}:${u.line}`)),
    uncalledCount: num(stats.uncalledCount),
  };

  const analysis: IndexedProject["analysis"] = {
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
    deadCode: p.deadCode && Array.isArray(p.deadCode.files) && Array.isArray(p.deadCode.exports) ? p.deadCode : undefined,
    thinFiles: thinFilesOf(p.coverage),
    risky: riskyFilesOf(p.blastRadius),
    testCoverage: testCoverageOf(p.testCoverage),
    docDrift: arr<DocDriftFinding>(p.docDrift?.findings).filter((f) => typeof f?.doc === "string" && typeof f?.line === "number"),
    // Only the entities: the per-file part of the store is `byFile` above, in the shapes the views read.
    store: { entitiesByName: store.entitiesByName },
    files,
    packages: arr<DeclaredDependency>(Array.isArray(p.externalPackages) ? p.externalPackages : p.externalPackages?.packages)
      .filter((d) => typeof d?.name === "string"),
  };
  return { analysis, classGraph: projectTypes(p.classGraph), history: historyData(p) };
}

/** What the analysis's git pass wrote: churn per file and the CODEOWNERS rules. */
interface HistoryData {
  churn: FileHistory["churn"];
  rules: { pattern: string; owners: string[] }[] | null;
}

function historyData(p: any): HistoryData {
  const rows = arr<any>(p.fileChurn).filter((r) => typeof r?.file === "string");
  const churn: FileHistory["churn"] = new Map(
    rows.map((r) => [r.file as string, { commits: num(r.commits) ?? 0, authors: arr<string>(r.authors), shares: Array.isArray(r.authorShares) ? r.authorShares : undefined, busFactor: typeof r.busFactor === "number" ? r.busFactor : undefined }]),
  );
  return { churn, rules: Array.isArray(p.codeOwners?.rules) ? p.codeOwners.rules : null };
}

/** Churn per file and a CODEOWNERS lookup. */
function historyOf({ churn, rules }: HistoryData, reader?: Pick<AnalysisReader, "ownersOf">): { history?: FileHistory } {
  if (churn.size === 0 && !rules) return {};
  const ownersOf = rules && reader?.ownersOf ? (file: string) => reader.ownersOf!(rules, file) : undefined;
  return { history: { churn, ...(ownersOf ? { ownersOf } : {}) } };
}

/** A memoized test-file check over the analysis's files, when the analyzer offers its rules. */
function testPredicate(
  files: Set<string>,
  rules?: Pick<AnalysisReader, "isTestFile" | "getLanguageForFile">,
): Pick<ResolvedAnalysis, "isTest" | "hasTests"> {
  const isTestFile = rules?.isTestFile;
  if (!isTestFile) return {};
  const memo = new Map<string, boolean>();
  const isTest = (file: string): boolean => {
    let v = memo.get(file);
    if (v === undefined) memo.set(file, (v = isTestFile(file, rules.getLanguageForFile?.(file) ?? undefined)));
    return v;
  };
  let hasTests = false;
  for (const f of files) if (isTest(f)) { hasTests = true; break; }
  return { isTest, hasTests };
}
