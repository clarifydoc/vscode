/**
 * What Ctrl+T finds that a language server cannot: routes by URL, screens by
 * name or route, data entities by name. Pure, no `vscode`.
 */
import type { ResolvedAnalysis } from "./analysisData";

export type SymbolRowKind = "api-route" | "frontend-route" | "screen" | "entity";

export interface SymbolRow {
  kind: SymbolRowKind;
  name: string;
  /** Shown beside the name: the file, or the route a screen is served at. */
  container: string;
  file: string;
  line: number;
}

/** Every row a folder's analysis contributes. */
export function symbolRows(a: ResolvedAnalysis): SymbolRow[] {
  const rows: SymbolRow[] = [];
  for (const r of a.routes) {
    rows.push({
      kind: r.kind === "frontend" ? "frontend-route" : "api-route",
      name: [r.httpMethod, r.path].filter(Boolean).join(" ") || r.path,
      container: r.handler ? `${r.handler} — ${r.filePath}` : r.filePath,
      file: r.filePath,
      line: r.line,
    });
  }
  for (const s of a.screens) {
    rows.push({
      kind: "screen",
      name: s.title ?? s.filePath,
      container: s.routePath ? `${s.routePath} — ${s.filePath}` : s.filePath,
      file: s.filePath,
      line: s.line ?? 1,
    });
  }
  for (const nodes of a.store.entitiesByName.values()) {
    for (const n of nodes) {
      if (typeof n?.name !== "string" || typeof n?.filePath !== "string") continue;
      rows.push({
        kind: "entity",
        name: n.name,
        container: n.orm ? `${n.orm} — ${n.filePath}` : n.filePath,
        file: n.filePath,
        line: typeof n.line === "number" ? n.line : 1,
      });
    }
  }
  return rows;
}

/**
 * Rows matching a query: every whitespace-separated term must occur in the
 * name or its container, ignoring case — `get orders` finds `GET /api/orders`.
 * Name matches rank before container-only ones. VS Code applies its own fuzzy
 * filter on top; this keeps the list it gets short.
 */
export function matchRows(rows: SymbolRow[], query: string, cap: number): SymbolRow[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { row: SymbolRow; score: number }[] = [];
  for (const row of rows) {
    const name = row.name.toLowerCase();
    const hay = `${name} ${row.container.toLowerCase()}`;
    if (!terms.every((t) => hay.includes(t))) continue;
    scored.push({ row, score: terms.filter((t) => name.includes(t)).length });
  }
  scored.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
  return scored.slice(0, cap).map((s) => s.row);
}
