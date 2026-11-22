/**
 * What a change did to elements — changed, added, removed, reached — as the
 * report marks them and as the Changed Elements view lists them. Pure, no
 * `vscode`: `changeOverlayHub.ts` keeps the state, `changedElementsView.ts`
 * draws it, `reportPanel.ts` hands it to the report page.
 *
 * What the analyzer states bounds what is claimed here. `impact --json` names
 * changed files, and the routes, screens and tables above and below them
 * (reached); it does not say which changed file is new, so nothing is "added"
 * from it. `diff --json` against a base states routes added and removed, so
 * those are.
 */
import type { ImpactResult } from "./impactModel";
import type { SurfaceDiff } from "./surfaceModel";

export type ChangeKind = "changed" | "added" | "removed" | "reached";
export type ChangeSubject = "file" | "route" | "screen" | "entity";

/** One element a change touched; the entry of the `clarifydoc:overlay` message. */
export interface ChangeEntry {
  kind: ChangeKind;
  of: ChangeSubject;
  /** A file's path, a route's path, a screen's file, an entity's name. */
  id: string;
  method?: string | null;
  file?: string;
  line?: number;
  note?: string;
}

/** The message body the report reads: a label and the entries. */
export interface ChangeOverlay {
  label: string;
  entries: ChangeEntry[];
}

/** The kinds from the strongest to the weakest; where two sources disagree, the first wins. */
export const KIND_ORDER: readonly ChangeKind[] = ["removed", "added", "changed", "reached"];
export const KIND_GLYPH: Record<ChangeKind, string> = { changed: "~", added: "+", removed: "−", reached: "→" };
export const KIND_LABEL: Record<ChangeKind, string> = { changed: "Changed", added: "Added", removed: "Removed", reached: "Reached" };

/** The working-tree change (`impact --json`): the files changed and what they reach. */
export function overlayFromImpact(r: Pick<ImpactResult, "changedFiles" | "screens" | "routes" | "entities" | "baseLabel"> & { baseLabel?: string }): ChangeOverlay {
  const entries: ChangeEntry[] = [];
  for (const f of r.changedFiles) entries.push({ kind: "changed", of: "file", id: f });
  for (const s of r.screens) entries.push({ kind: "reached", of: "screen", id: s.file, file: s.file, note: s.name });
  for (const x of r.routes) entries.push({ kind: "reached", of: "route", id: x.path, method: x.method, file: x.file, line: x.line });
  for (const e of r.entities) entries.push({ kind: "reached", of: "entity", id: e });
  return { label: "Uncommitted changes" + (r.baseLabel && r.baseLabel !== "HEAD" ? ` vs ${r.baseLabel}` : ""), entries };
}

/** `GET /api/v2/clubs/{id}` → its method and path; a label with no leading verb is all path. */
export function splitRoute(route: string): { method: string | null; path: string } {
  const m = /^([A-Z]+|\*)\s+(\S.*)$/.exec(route.trim());
  return m ? { method: m[1] === "*" ? null : m[1]!, path: m[2]! } : { method: null, path: route.trim() };
}

/**
 * The API-surface comparison (`diff --json`) as an overlay: a route added or
 * removed is that, any other change to a route marks it changed. A changed
 * route's file is changed too; a removed route's file may be gone, so it is
 * not marked.
 */
export function overlayFromSurface(d: Pick<SurfaceDiff, "changes">, baseLabel: string): ChangeOverlay {
  const entries: ChangeEntry[] = [];
  for (const c of d.changes) {
    const { method, path } = splitRoute(c.route);
    const kind: ChangeKind = c.kind === "route-removed" ? "removed" : c.kind === "route-added" ? "added" : "changed";
    const note = c.reasons.join("; ") || undefined;
    entries.push({ kind, of: "route", id: path, method, ...(c.file ? { file: c.file } : {}), ...(c.line ? { line: c.line } : {}), ...(note ? { note } : {}) });
    if (kind !== "removed" && c.file) entries.push({ kind: "changed", of: "file", id: c.file });
  }
  return { label: `API surface vs ${baseLabel}`, entries };
}

/** Merge overlays; an element named twice keeps its strongest kind. Null when nothing is left. */
export function mergeOverlays(parts: Array<ChangeOverlay | null | undefined>): ChangeOverlay | null {
  const kept = parts.filter((p): p is ChangeOverlay => !!p && p.entries.length > 0);
  if (kept.length === 0) return null;
  const byKey = new Map<string, ChangeEntry>();
  for (const e of kept.flatMap((p) => p.entries)) {
    const key = `${e.of}\0${(e.method ?? "").toUpperCase()}\0${e.id}`;
    const had = byKey.get(key);
    if (!had || KIND_ORDER.indexOf(e.kind) < KIND_ORDER.indexOf(had.kind)) byKey.set(key, e);
  }
  return { label: kept.map((p) => p.label).join("; "), entries: [...byKey.values()] };
}

export interface ChangedNode {
  label: string;
  description?: string;
  kind?: ChangeKind;
  /** The subject, for the icon. */
  of?: ChangeSubject;
  file?: string;
  line?: number;
  children?: ChangedNode[];
}

/** The Changed Elements tree: one group per kind (strongest first), then per subject. The glyph leads every label, so the kind never rests on colour. */
export function changedElementNodes(o: ChangeOverlay | null): ChangedNode[] {
  if (!o || o.entries.length === 0) return [{ label: "Nothing changed that the analysis can place" }];
  const groups: ChangedNode[] = [];
  for (const kind of KIND_ORDER) {
    const mine = o.entries.filter((e) => e.kind === kind);
    if (mine.length === 0) continue;
    const children = mine
      .slice()
      .sort((a, b) => a.of.localeCompare(b.of) || a.id.localeCompare(b.id))
      .map<ChangedNode>((e) => ({
        label: `${KIND_GLYPH[kind]} ${e.of === "route" ? `${e.method ? e.method.toUpperCase() + " " : ""}${e.id}` : e.id}`,
        description: [e.of, e.note].filter(Boolean).join(" · "),
        kind,
        of: e.of,
        // A route or screen opens where it is written; a file opens itself; an entity has no place.
        ...(e.file ? { file: e.file } : e.of === "file" ? { file: e.id } : {}),
        ...(e.line ? { line: e.line } : {}),
      }));
    groups.push({ label: `${KIND_GLYPH[kind]} ${KIND_LABEL[kind]}`, description: String(mine.length), kind, children });
  }
  return groups;
}

/** The message the report page reads (`clarifydoc:overlay`); `null` clears its marks. */
export function overlayMessage(overlay: ChangeOverlay | null): { type: "clarifydoc:overlay"; overlay: ChangeOverlay | null } {
  return { type: "clarifydoc:overlay", overlay };
}
