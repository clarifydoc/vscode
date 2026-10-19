/**
 * The database end of the map, inverted: for each table (or collection) the
 * routes and screens that read or write it, from the analysis's data flows.
 * Pure — no `vscode` — so the sidebar and its tests share it.
 */
import type { ResolvedAnalysis } from "./analysisData";

export interface TableEntry {
  kind: "route" | "screen";
  label: string;
  file: string;
  line?: number;
  writes: boolean;
  reads: boolean;
}

export interface TableUse {
  resource: string;
  /** Where the entity is declared, when the analysis found one by that name. */
  entity?: { file: string; line?: number };
  entries: TableEntry[];
  writers: number;
  readers: number;
}

/** Tables by how many entry points use them, most first. */
export function tableUses(a: ResolvedAnalysis): TableUse[] {
  const byTable = new Map<string, Map<string, TableEntry>>();
  for (const flows of a.crossTier.flowsByEntryFile.values()) {
    for (const f of flows) {
      if (!f.effect.startsWith("db") || !f.resource) continue;
      let entries = byTable.get(f.resource);
      if (!entries) byTable.set(f.resource, (entries = new Map()));
      const key = `${f.entryKind}\0${f.entryFile}\0${f.entryLabel}`;
      let e = entries.get(key);
      if (!e) entries.set(key, (e = { kind: f.entryKind, label: f.entryLabel, file: f.entryFile, line: entryLine(a, f.entryKind, f.entryFile, f.entryLabel), writes: false, reads: false }));
      if (f.effect === "db-write") e.writes = true;
      else e.reads = true; // `db-read`, or a use whose direction is unknown
    }
  }
  const out: TableUse[] = [];
  for (const [resource, entries] of byTable) {
    const list = [...entries.values()].sort((x, y) => Number(y.writes) - Number(x.writes) || x.label.localeCompare(y.label));
    out.push({
      resource,
      entity: entityOf(a, resource),
      entries: list,
      writers: list.filter((e) => e.writes).length,
      readers: list.filter((e) => e.reads).length,
    });
  }
  return out.sort((x, y) => y.entries.length - x.entries.length || x.resource.localeCompare(y.resource));
}

/** `written by 2 routes · read by 1 route, 2 screens`. */
export function describeTable(t: TableUse): string {
  const count = (pred: (e: TableEntry) => boolean): string => {
    const routes = t.entries.filter((e) => pred(e) && e.kind === "route").length;
    const screens = t.entries.filter((e) => pred(e) && e.kind === "screen").length;
    return [routes && `${routes} route${routes === 1 ? "" : "s"}`, screens && `${screens} screen${screens === 1 ? "" : "s"}`].filter(Boolean).join(", ");
  };
  return [t.writers && `written by ${count((e) => e.writes)}`, t.readers && `read by ${count((e) => e.reads)}`].filter(Boolean).join(" · ");
}

function entryLine(a: ResolvedAnalysis, kind: "route" | "screen", file: string, label: string): number | undefined {
  if (kind === "route") return a.routes.find((r) => r.filePath === file && [r.httpMethod, r.path].filter(Boolean).join(" ") === label)?.line;
  return a.screens.find((s) => s.filePath === file && (s.title === label || !s.title))?.line;
}

/** The entity a table name belongs to: same name, else a case-insensitive / singular match. */
function entityOf(a: ResolvedAnalysis, resource: string): TableUse["entity"] {
  const pick = (nodes: any[] | undefined) => {
    const n = nodes?.find((x) => typeof x?.filePath === "string");
    return n ? { file: n.filePath as string, line: typeof n.line === "number" ? n.line : undefined } : undefined;
  };
  const direct = pick(a.store.entitiesByName.get(resource));
  if (direct) return direct;
  const want = resource.toLowerCase().replace(/^.*\./, "");
  for (const [name, nodes] of a.store.entitiesByName) {
    const n = name.toLowerCase();
    if (n === want || `${n}s` === want || `${n}es` === want || (n.endsWith("y") && `${n.slice(0, -1)}ies` === want)) {
      const hit = pick(nodes);
      if (hit) return hit;
    }
  }
  return undefined;
}
