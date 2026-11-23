/**
 * The docked graph's three cuts (VSCODE 12.5), as view models:
 *   symbol        — the open file's functions and the calls in and out (today's call view)
 *   file          — the files the open file imports and the files that import it
 *   architecture  — the unit (community, else folder) the file sits in, and the units
 *                   its files depend on and that depend on them
 * All three are drawn from facts the analysis already wrote (`componentGraph`,
 * `communities`, `deadCode`); nothing is parsed or asked of the analyzer here.
 *
 * Pure, no `vscode`, so it is unit-tested.
 */
import { filesGraph, label, type GraphFile, type GraphView } from "./filesGraph";

export type Mode = "symbol" | "file" | "architecture";
export const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: "symbol", label: "Symbol" },
  { id: "file", label: "File" },
  { id: "architecture", label: "Architecture" },
];

/** What the file and architecture cuts read from the summary. */
export interface NeighbourhoodFacts {
  /** file → the files it imports. */
  componentGraph: Record<string, string[]>;
  /** community id → its files. */
  communities: Record<string, string[]>;
  communityNames: Record<string, { name?: string }>;
  fileProjects: Record<string, string>;
  subProjects: { id?: string; name?: string }[];
}

/** The dead-code facts the cuts dim by. */
export interface DeadFacts {
  files: ReadonlySet<string>;
  unusedExports: ReadonlyMap<string, number>;
}

export interface ModeCut {
  id: Mode;
  label: string;
  views: GraphView[];
  /** One line under the controls; says so when the cut was capped. */
  note: string;
}

export interface NeighbourhoodCaps {
  /** Files drawn on each side of the file cut. */
  maxFiles: number;
  /** Units drawn on each side of the architecture cut. */
  maxUnits: number;
}
export const DEFAULT_CAPS: NeighbourhoodCaps = { maxFiles: 15, maxUnits: 10 };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const folderOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".");
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function deadFactsOf(dead?: { files: { filePath: string }[]; exports: { filePath: string }[] }): DeadFacts {
  const unusedExports = new Map<string, number>();
  for (const e of dead?.exports ?? []) unusedExports.set(e.filePath, (unusedExports.get(e.filePath) ?? 0) + 1);
  return { files: new Set((dead?.files ?? []).map((f) => f.filePath)), unusedExports };
}

/** Who imports each file, built once per component graph. */
const importersCache = new WeakMap<object, Map<string, string[]>>();
function importersOf(graph: Record<string, string[]>): Map<string, string[]> {
  let m = importersCache.get(graph);
  if (!m) {
    m = new Map();
    for (const [from, tos] of Object.entries(graph)) for (const to of tos) (m.get(to) ?? m.set(to, []).get(to)!).push(from);
    importersCache.set(graph, m);
  }
  return m;
}

/** Imports and importers of one file; a file with many neighbours shows the ones most connected first. */
export function fileCut(file: string, facts: NeighbourhoodFacts, dead: DeadFacts, caps = DEFAULT_CAPS): ModeCut {
  const degree = (f: string) => (facts.componentGraph[f]?.length ?? 0) + (importersOf(facts.componentGraph).get(f)?.length ?? 0);
  const rank = (list: string[]) => [...new Set(list)].filter((f) => f !== file).sort((a, b) => degree(b) - degree(a) || byName(a, b));
  const imports = rank(facts.componentGraph[file] ?? []);
  const importers = rank(importersOf(facts.componentGraph).get(file) ?? []);
  const nodes: GraphView["nodes"] = { c: { file } };
  const lines = ["flowchart LR"];
  const mark = (f: string) => (dead.files.has(f) ? `${f}\n(unreachable)` : f);
  const unused = dead.unusedExports.get(file) ?? 0;
  lines.push(`  c[${label(base(file) + (unused ? `\n${plural(unused, "unused export")}` : "") + (dead.files.has(file) ? "\n(unreachable)" : ""))}]:::focus`);
  const side = (list: string[], prefix: "i" | "o") => {
    const shown = list.slice(0, caps.maxFiles);
    shown.forEach((f, i) => {
      const id = `${prefix}${i}`;
      nodes[id] = { file: f };
      const isDead = dead.files.has(f);
      lines.push(`  ${id}[${label(mark(f))}]${isDead ? ":::dead" : ""}`);
      const arrow = isDead ? "-.->" : "-->";
      lines.push(prefix === "i" ? `  ${id} ${arrow} c` : `  c ${arrow} ${id}`);
    });
    if (list.length > shown.length) {
      lines.push(`  ${prefix}more[${label(`+${plural(list.length - shown.length, "more file")}`)}]:::more`);
      lines.push(prefix === "i" ? `  ${prefix}more -.-> c` : `  c -.-> ${prefix}more`);
    }
    return shown.length;
  };
  const nIn = side(importers, "i");
  const nOut = side(imports, "o");
  lines.push("  classDef focus stroke-width:3px", "  classDef dead stroke-dasharray: 4 3,opacity:0.6", "  classDef more opacity:0.6");
  const capped = importers.length > nIn || imports.length > nOut;
  const total = `${plural(importers.length, "importer")} · ${plural(imports.length, "import")}`;
  const note = !(importers.length || imports.length)
    ? "No imports in or out of this file are recorded."
    : capped
      ? `${total} — showing the ${caps.maxFiles} most connected on each side; the rest are folded. Dashed grey: unreachable files.`
      : `${total}. Dashed grey: unreachable files.`;
  return { id: "file", label: "File", views: [{ label: "Imports", mermaid: lines.join("\n"), nodes }], note };
}

interface UnitIndex {
  unitOf: Map<string, string>;
  name: Map<string, string>;
  files: Map<string, string[]>;
  out: Map<string, Map<string, number>>;
  in: Map<string, Map<string, number>>;
}
const unitCache = new WeakMap<object, UnitIndex>();

/** Units — communities, files outside any one taking their folder — and the import edges between them, once per analysis. */
function unitIndex(facts: NeighbourhoodFacts): UnitIndex {
  let u = unitCache.get(facts.componentGraph);
  if (u) return u;
  const unitOf = new Map<string, string>();
  const name = new Map<string, string>();
  const files = new Map<string, string[]>();
  for (const [id, members] of Object.entries(facts.communities)) {
    const key = `community:${id}`;
    name.set(key, facts.communityNames[id]?.name || `community ${id}`);
    files.set(key, [...members].sort(byName));
    for (const f of members) unitOf.set(f, key);
  }
  const unit = (f: string) => {
    let k = unitOf.get(f);
    if (!k) {
      k = `folder:${folderOf(f)}`;
      unitOf.set(f, k);
      name.set(k, `${folderOf(f)}/`);
      files.set(k, []);
    }
    return k;
  };
  const out = new Map<string, Map<string, number>>();
  const inn = new Map<string, Map<string, number>>();
  const bump = (m: Map<string, Map<string, number>>, a: string, b: string) => {
    const row = m.get(a) ?? m.set(a, new Map()).get(a)!;
    row.set(b, (row.get(b) ?? 0) + 1);
  };
  for (const [from, tos] of Object.entries(facts.componentGraph)) {
    for (const to of new Set(tos)) {
      const a = unit(from);
      const b = unit(to);
      if (a === b) continue;
      bump(out, a, b);
      bump(inn, b, a);
    }
  }
  u = { unitOf, name, files, out, in: inn };
  unitCache.set(facts.componentGraph, u);
  return u;
}

/** The unit a file sits in and the units on each side of it. */
export function architectureCut(file: string, facts: NeighbourhoodFacts, dead: DeadFacts, caps = DEFAULT_CAPS): ModeCut {
  const idx = unitIndex(facts);
  const home = idx.unitOf.get(file) ?? `folder:${folderOf(file)}`;
  const project = (f: string) => {
    const id = facts.fileProjects[f];
    const named = facts.subProjects.find((p) => p.id === id);
    return facts.subProjects.length > 1 ? (named?.name ?? id) : undefined;
  };
  const members = idx.files.get(home) ?? [];
  const deadCount = members.filter((f) => dead.files.has(f)).length;
  const nodes: GraphView["nodes"] = { u: { file } };
  const lines = ["flowchart LR"];
  const proj = project(file);
  const homeLabel = [idx.name.get(home) ?? `${folderOf(file)}/`, members.length ? plural(members.length, "file") : undefined, proj ? `project ${proj}` : undefined, `this file: ${folderOf(file)}/${base(file)}`, deadCount ? `${deadCount} unreachable` : undefined]
    .filter(Boolean)
    .join("\n");
  lines.push(`  u[${label(homeLabel)}]:::focus`);
  const rep = (key: string): string => idx.files.get(key)?.[0] ?? file;
  const side = (row: Map<string, number> | undefined, prefix: "i" | "o") => {
    const ranked = [...(row ?? [])].sort((a, b) => b[1] - a[1] || byName(a[0], b[0]));
    const shown = ranked.slice(0, caps.maxUnits);
    shown.forEach(([key, n], i) => {
      const id = `${prefix}${i}`;
      const first = rep(key);
      nodes[id] = { file: first };
      const unitDead = (idx.files.get(key) ?? []).length > 0 && (idx.files.get(key) ?? []).every((f) => dead.files.has(f));
      const text = `${idx.name.get(key) ?? key}${unitDead ? "\n(unreachable)" : ""}`;
      lines.push(`  ${id}[${label(text)}]${unitDead ? ":::dead" : ""}`);
      const edge = `|${label(plural(n, "import"))}|`;
      lines.push(prefix === "i" ? `  ${id} -->${edge} u` : `  u -->${edge} ${id}`);
    });
    if (ranked.length > shown.length) {
      lines.push(`  ${prefix}more[${label(`+${plural(ranked.length - shown.length, "more unit")}`)}]:::more`);
      lines.push(prefix === "i" ? `  ${prefix}more -.-> u` : `  u -.-> ${prefix}more`);
    }
    return { shown: shown.length, total: ranked.length };
  };
  const i = side(idx.in.get(home), "i");
  const o = side(idx.out.get(home), "o");
  lines.push("  classDef focus stroke-width:3px", "  classDef dead stroke-dasharray: 4 3,opacity:0.6", "  classDef more opacity:0.6");
  const total = `Imported by ${plural(i.total, "unit")} · imports from ${plural(o.total, "unit")} (counts are over all files of the unit)`;
  const capped = i.total > i.shown || o.total > o.shown;
  const note = i.total + o.total === 0
    ? "This unit has no imports to or from other units."
    : capped
      ? `${total} — showing the ${caps.maxUnits} most connected on each side; the rest are folded.`
      : `${total}.`;
  return { id: "architecture", label: "Architecture", views: [{ label: "Units", mermaid: lines.join("\n"), nodes }], note };
}

/** The open file's functions and calls — the two views the panel always had. */
export function symbolCut(input: GraphFile): ModeCut {
  const g = filesGraph([input], { maxPerFile: 25, maxOutside: 10 });
  return { id: "symbol", label: "Symbol", views: [g.functions, g.files], note: g.summary };
}

/** All three cuts for one file, in `MODES` order. A cut whose facts the analysis lacks says so rather than drawing nothing. */
export function allCuts(input: GraphFile, facts: NeighbourhoodFacts | undefined, dead: DeadFacts, caps = DEFAULT_CAPS): ModeCut[] {
  const sym = symbolCut(input);
  if (!facts) {
    const none = (id: Mode, lbl: string): ModeCut => ({ id, label: lbl, views: [], note: "This analysis has no import graph — run ClarifyDoc: Analyze Workspace again." });
    return [sym, none("file", "File"), none("architecture", "Architecture")];
  }
  return [sym, fileCut(input.file, facts, dead, caps), architectureCut(input.file, facts, dead, caps)];
}
