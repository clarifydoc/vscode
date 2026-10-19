/**
 * A graph of the files someone selected (VSCODE 9.2): each file a group of
 * its functions, the calls between them, the calls in and out of the
 * selection folded onto the files at the other end, and the HTTP calls that
 * cross a tier — to the route that serves them, named by method and path.
 * Two views of the same facts: functions as rows, or files only.
 *
 * Everything drawn is a link the analysis made; nothing is inferred here
 * beyond placing an HTTP call in the function whose body holds its line.
 *
 * Pure, no `vscode`, so it is unit-tested.
 */
import type { ApiRouteLink, RouteInfo, SymbolLink } from "./analysisData";

export interface GraphFile {
  file: string;
  defs: Array<{ symbol: string; kind: "function" | "class"; line: number }>;
  outbound: SymbolLink[];
  inbound: SymbolLink[];
  callsRoutes: ApiRouteLink[];
  servesCalls: ApiRouteLink[];
  routes: RouteInfo[];
}

export interface GraphView {
  label: string;
  mermaid: string;
  /** Mermaid node id → the source it stands for, for click-to-open. */
  nodes: Record<string, { file: string; line?: number }>;
}

export interface GraphOptions {
  /** Functions drawn per file; the rest fold into one "+N more" row. */
  maxPerFile?: number;
  /** Files outside the selection drawn; the rest fold into one node. */
  maxOutside?: number;
}

const label = (s: string) => `"${s.replace(/"/g, "#quot;").replace(/[<>]/g, (c) => (c === "<" ? "#lt;" : "#gt;"))}"`;
const routeName = (method: string | undefined | null, p: string) => `${method ? method.toUpperCase() + " " : ""}${p}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The symbol the linker mints for a route, `route:<METHOD> <path>`. */
const ROUTE_ANCHOR = "route:";

/**
 * What a symbol link is, by its relation or the strategy that made it. An
 * HTTP hop is drawn from the route link instead (it names the route), and a
 * reference is an import's back-edge, not a call.
 */
function linkKind(l: SymbolLink): "call" | "message" | null {
  // A link INTO a route's anchor (`route:GET /x`) is the HTTP hop again; one out of it is the route running its handler.
  if (l.targetSymbol.startsWith(ROUTE_ANCHOR)) return null;
  const relation = l.relation ?? (l.strategy === "api-route" ? "http" : l.strategy === "queue" ? "mq" : l.strategy === "reference" || l.strategy === "lsp-reference" ? "reference" : "calls");
  if (relation === "http" || relation === "reference") return null;
  return relation === "mq" ? "message" : "call";
}

/** The function whose definition starts last at or before `line` — where a call on that line sits. */
function enclosing(defs: GraphFile["defs"], line: number): string | undefined {
  let best: GraphFile["defs"][number] | undefined;
  for (const d of defs) if (d.kind === "function" && d.line <= line && (!best || d.line >= best.line)) best = d;
  return best?.symbol;
}

class Edges {
  private readonly counts = new Map<string, { from: string; to: string; n: number; http?: string; dashed: boolean }>();
  add(from: string, to: string, opts: { http?: string; dashed?: boolean } = {}): void {
    const key = `${from}\0${to}\0${opts.http ?? ""}`;
    const e = this.counts.get(key);
    if (e) e.n++;
    else this.counts.set(key, { from, to, n: 1, http: opts.http, dashed: !!opts.dashed });
  }
  lines(): string[] {
    return [...this.counts.values()].map((e) => {
      const text = e.http ?? (e.n > 1 ? plural(e.n, "call") : "");
      const arrow = e.dashed ? "-.->" : "-->";
      return text ? `  ${e.from} ${arrow}|${label(text)}| ${e.to}` : `  ${e.from} ${arrow} ${e.to}`;
    });
  }
  get size(): number {
    return this.counts.size;
  }
}

/** Files outside the selection, ranked by how much the selection touches them; the tail folds into one node. */
class Outside {
  private readonly weight = new Map<string, number>();
  constructor(private readonly selected: Set<string>, private readonly max: number) {}
  note(file: string): void {
    if (!this.selected.has(file)) this.weight.set(file, (this.weight.get(file) ?? 0) + 1);
  }
  private shown?: Map<string, string>;
  private rest = 0;
  resolve(): void {
    const ranked = [...this.weight].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    this.shown = new Map(ranked.slice(0, this.max).map(([f], i) => [f, `x${i}`]));
    this.rest = ranked.length - this.shown.size;
  }
  id(file: string): string {
    return this.shown!.get(file) ?? "xrest";
  }
  lines(nodes: GraphView["nodes"]): string[] {
    const out = [...this.shown!].map(([f, id]) => {
      nodes[id] = { file: f };
      return `  ${id}[${label(f)}]:::outside`;
    });
    if (this.rest > 0) out.push(`  xrest[${label(`+${plural(this.rest, "more file")}`)}]:::outside`);
    return out;
  }
}

const STYLE = [
  "  classDef outside stroke-dasharray: 4 3,opacity:0.8",
  "  classDef route stroke-width:2px",
  "  classDef more opacity:0.6",
];

export function filesGraph(input: readonly GraphFile[], opts: GraphOptions = {}): { functions: GraphView; files: GraphView; summary: string } {
  const maxPerFile = opts.maxPerFile ?? 30;
  const maxOutside = opts.maxOutside ?? 12;
  const files = [...input].sort((a, b) => (a.file < b.file ? -1 : 1));
  const selected = new Set(files.map((f) => f.file));
  const fileIdx = new Map(files.map((f, i) => [f.file, i]));
  const out = (f: GraphFile) => f.outbound.filter((l) => linkKind(l));
  const inn = (f: GraphFile) => f.inbound.filter((l) => linkKind(l));
  const edgeOpts = (l: SymbolLink) => (linkKind(l) === "message" ? { http: "message", dashed: true } : {});

  // ── Functions as rows ──────────────────────────────────────────────────
  const fnNodes: GraphView["nodes"] = {};
  const fnLines: string[] = ["flowchart LR"];
  const fnEdges = new Edges();
  const outsideFn = new Outside(selected, maxOutside);
  // Which functions take part in an edge: those are drawn first when a file has more than fit.
  const active = new Map<string, Set<string>>(files.map((f) => [f.file, new Set<string>()]));
  for (const f of files) {
    for (const l of out(f)) {
      active.get(f.file)!.add(l.sourceSymbol);
      if (selected.has(l.targetFile)) active.get(l.targetFile)!.add(l.targetSymbol);
      outsideFn.note(l.targetFile);
    }
    for (const l of inn(f)) {
      active.get(f.file)!.add(l.targetSymbol);
      outsideFn.note(l.sourceFile);
    }
    for (const c of f.callsRoutes) {
      const fn = enclosing(f.defs, c.sourceLine);
      if (fn) active.get(f.file)!.add(fn);
      outsideFn.note(c.target);
    }
    for (const c of f.servesCalls) outsideFn.note(c.source);
  }
  outsideFn.resolve();

  const fnId = new Map<string, string>(); // file\0symbol → id
  const routeId = new Map<string, string>(); // file\0METHOD path → id
  const fileTop = new Map<string, string>(); // a file's own node, for links from top-level code or folded rows
  for (const f of files) {
    const i = fileIdx.get(f.file)!;
    fnLines.push(`  subgraph f${i}[${label(f.file)}]`, "    direction TB");
    const fns = f.defs.filter((d) => d.kind === "function");
    const used = active.get(f.file)!;
    const ordered = [...fns.filter((d) => used.has(d.symbol)), ...fns.filter((d) => !used.has(d.symbol))];
    const shown = ordered.slice(0, maxPerFile);
    for (const [j, d] of shown.entries()) {
      const id = `f${i}n${j}`;
      fnId.set(`${f.file}\0${d.symbol}`, id);
      fnNodes[id] = { file: f.file, line: d.line };
      fnLines.push(`    ${id}[${label(d.symbol)}]`);
    }
    if (ordered.length > shown.length) fnLines.push(`    f${i}more[${label(`+${plural(ordered.length - shown.length, "more function")}`)}]:::more`);
    for (const [j, r] of f.routes.filter((r) => r.kind !== "frontend").slice(0, maxPerFile).entries()) {
      const id = `f${i}r${j}`;
      routeId.set(`${f.file}\0${routeName(r.httpMethod, r.path)}`, id);
      fnNodes[id] = { file: f.file, line: r.line };
      fnLines.push(`    ${id}([${label(routeName(r.httpMethod, r.path))}]):::route`);
    }
    fnLines.push("  end");
    fileTop.set(f.file, `f${i}`);
  }
  // A symbol with no row of its own (top-level code, a folded row) speaks for its file's group.
  const nodeOf = (file: string, symbol: string) =>
    fnId.get(`${file}\0${symbol}`) ??
    (symbol.startsWith(ROUTE_ANCHOR) ? routeId.get(`${file}\0${symbol.slice(ROUTE_ANCHOR.length)}`) : undefined) ??
    fileTop.get(file)!;
  for (const f of files) {
    for (const l of out(f)) {
      const from = nodeOf(f.file, l.sourceSymbol);
      fnEdges.add(from, selected.has(l.targetFile) ? nodeOf(l.targetFile, l.targetSymbol) : outsideFn.id(l.targetFile), edgeOpts(l));
    }
    for (const l of inn(f)) {
      if (!selected.has(l.sourceFile)) fnEdges.add(outsideFn.id(l.sourceFile), nodeOf(f.file, l.targetSymbol), edgeOpts(l));
    }
    for (const c of f.callsRoutes) {
      const fn = enclosing(f.defs, c.sourceLine);
      const from = fn ? nodeOf(f.file, fn) : fileTop.get(f.file)!;
      const http = routeName(c.method, c.routePath);
      const to = selected.has(c.target) ? (routeId.get(`${c.target}\0${http}`) ?? fileTop.get(c.target)!) : outsideFn.id(c.target);
      fnEdges.add(from, to, { http, dashed: true });
    }
    for (const c of f.servesCalls) {
      if (selected.has(c.source)) continue; // drawn from the caller's side
      const http = routeName(c.method, c.routePath);
      fnEdges.add(outsideFn.id(c.source), routeId.get(`${f.file}\0${http}`) ?? fileTop.get(f.file)!, { http, dashed: true });
    }
  }
  fnLines.push(...outsideFn.lines(fnNodes), ...fnEdges.lines(), ...STYLE);

  // ── Files only ─────────────────────────────────────────────────────────
  const fileNodes: GraphView["nodes"] = {};
  const fileLines: string[] = ["flowchart LR"];
  const fileEdges = new Edges();
  const outsideFile = new Outside(selected, maxOutside);
  for (const f of files) {
    for (const l of out(f)) outsideFile.note(l.targetFile);
    for (const l of inn(f)) outsideFile.note(l.sourceFile);
    for (const c of f.callsRoutes) outsideFile.note(c.target);
    for (const c of f.servesCalls) outsideFile.note(c.source);
  }
  outsideFile.resolve();
  const fid = (file: string) => (selected.has(file) ? `s${fileIdx.get(file)}` : outsideFile.id(file));
  for (const f of files) {
    const id = `s${fileIdx.get(f.file)}`;
    fileNodes[id] = { file: f.file };
    const routes = f.routes.filter((r) => r.kind !== "frontend").length;
    fileLines.push(`  ${id}[${label(f.file + (routes ? `\n${plural(routes, "route")}` : ""))}]`);
  }
  for (const f of files) {
    for (const l of out(f)) if (l.targetFile !== f.file) fileEdges.add(fid(f.file), fid(l.targetFile), edgeOpts(l));
    for (const l of inn(f)) if (!selected.has(l.sourceFile)) fileEdges.add(fid(l.sourceFile), fid(f.file), edgeOpts(l));
    for (const c of f.callsRoutes) fileEdges.add(fid(f.file), fid(c.target), { http: routeName(c.method, c.routePath), dashed: true });
    for (const c of f.servesCalls) if (!selected.has(c.source)) fileEdges.add(fid(c.source), fid(f.file), { http: routeName(c.method, c.routePath), dashed: true });
  }
  fileLines.push(...outsideFile.lines(fileNodes), ...fileEdges.lines(), ...STYLE);

  const http = files.reduce((n, f) => n + f.callsRoutes.length, 0);
  const summary = `${plural(files.length, "file")} · ${plural(fnEdges.size, "edge")}${http ? ` · ${plural(http, "HTTP call")} across tiers` : ""}`;
  return {
    functions: { label: "Functions", mermaid: fnLines.join("\n"), nodes: fnNodes },
    files: { label: "Files", mermaid: fileLines.join("\n"), nodes: fileNodes },
    summary,
  };
}
