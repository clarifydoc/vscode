/**
 * `clarifydoc diff --json` (the analyzer's SurfaceDiff) as an Impact-view
 * group: what the branch changes in the API surface compared with the base —
 * a route gone or moved, a guard lost, a body that now requires a field, a
 * call that no longer reaches its route — breaking first. Pure, no `vscode`.
 */
import type { ImpactNode } from "./impactModel";

export interface SurfaceChange {
  kind: string;
  breaking: boolean;
  risky?: boolean;
  route: string;
  project?: string;
  file?: string;
  line?: number;
  reasons: string[];
}

export interface SurfaceDiff {
  changes: SurfaceChange[];
  counts: { total: number; breaking: number; risky: number; routesAdded: number; routesRemoved: number };
  /** Import cycles the head has and the base did not: new ones, and ones that absorbed files. Counted in `total` and `risky`. */
  cycles?: { introduced: string[][]; grown: Array<{ files: string[]; added: string[] }> };
}

/** A route whose flow differs between the base and the head, with the plain-text sequence diff behind it. */
export interface BehaviourRow {
  route: string;
  file?: string;
  /** How many steps of the flow changed. */
  steps: number;
}

const KIND_LABEL: Record<string, string> = {
  "route-removed": "removed",
  "route-added": "added",
  "route-moved": "moved",
  "param-changed": "parameter",
  "body-changed": "request body",
  "guard-lost": "guard lost",
  "guard-added": "guard added",
  "version-removed": "version removed",
  "version-deprecated": "version deprecated",
  "link-lost": "call no longer linked",
  "link-moved": "call reaches another route",
  "link-gained": "call newly linked",
  "data-effect-changed": "data reached",
};

/** At most this many changes are listed; the rest are counted. */
const MAX_LISTED = 60;

/** The cycle rows: each opens its first file and lists every file of the cycle beneath it. */
export function cycleNodes(d: SurfaceDiff): ImpactNode[] {
  const files = (list: string[]): ImpactNode[] => list.map((f) => ({ label: f, icon: "file", file: f }));
  const nodes: ImpactNode[] = [];
  for (const c of d.cycles?.introduced ?? []) {
    nodes.push({ label: `import cycle: ${c.join(" \u2194 ")}`, description: "new import cycle \u00b7 risky", icon: "risk", level: "moderate", ...(c[0] ? { file: c[0] } : {}), children: files(c) });
  }
  for (const g of d.cycles?.grown ?? []) {
    const how = g.added.length ? `grown by ${g.added.join(", ")}` : "two cycles merged";
    nodes.push({ label: `import cycle: ${g.files.length} files`, description: `${how} \u00b7 risky`, icon: "risk", level: "moderate", ...(g.files[0] ? { file: g.files[0] } : {}), children: files(g.files) });
  }
  return nodes;
}

/** Cap on routes whose sequence is compared: `seq --diff` runs once per candidate. */
export const MAX_BEHAVIOUR_CANDIDATES = 12;

const FLOW_KINDS = new Set(["body-changed", "param-changed", "data-effect-changed"]);

/**
 * The routes worth a sequence comparison, cheaply: those the surface diff says
 * changed on a route that still exists (body, parameters, data reached), then
 * routes declared in a file the change touched. Never every route.
 */
export function behaviourCandidates(
  d: SurfaceDiff,
  changedFiles: readonly string[],
  headRoutes: ReadonlyArray<{ route: string; file?: string | null }>,
  cap = MAX_BEHAVIOUR_CANDIDATES,
): Array<{ route: string; file?: string }> {
  const out = new Map<string, { route: string; file?: string }>();
  const add = (route: string, file?: string | null) => {
    if (out.size < cap && !out.has(route)) out.set(route, { route, ...(file ? { file } : {}) });
  };
  for (const ch of d.changes) if (FLOW_KINDS.has(ch.kind)) add(ch.route, ch.file);
  const touched = new Set(changedFiles);
  for (const r of headRoutes) if (r.file && touched.has(r.file)) add(r.route, r.file);
  return [...out.values()];
}

/** The number of changed steps in `clarifydoc seq --diff` output; null when the flow is unchanged or new. */
export function parseSeqDiff(output: string): number | null {
  const m = /: (\d+) changes? in the flow/.exec(output.split("\n")[0] ?? "");
  return m ? Number(m[1]) : null;
}

/** `folder` is handed back to the command, which cannot otherwise tell which workspace folder the row is from. */
export function behaviourNodes(rows: readonly BehaviourRow[], folder?: unknown): ImpactNode[] {
  return rows.map((r) => ({
    label: r.route,
    description: `behaviour changed \u2014 ${r.steps} step${r.steps === 1 ? "" : "s"} of the flow changed \u00b7 click for the sequence diff`,
    icon: "route",
    command: { id: "clarifydoc.showSequenceDiff", title: "Show sequence diff", arguments: [folder, r.route, r.file] },
  }));
}

export function surfaceNode(d: SurfaceDiff, baseLabel: string, behaviour: readonly BehaviourRow[] = [], folder?: unknown): ImpactNode {
  const c = d.counts;
  if (c.total === 0 && behaviour.length === 0) return { label: `API surface vs ${baseLabel}`, description: "no change", icon: "info" };
  const shown = d.changes.slice(0, MAX_LISTED);
  const children: ImpactNode[] = shown.map((ch) => ({
    label: ch.route,
    description: `${KIND_LABEL[ch.kind] ?? ch.kind}${ch.breaking ? " · breaking" : ch.risky ? " · risky" : ""} — ${ch.reasons.join("; ")}`,
    icon: ch.breaking ? "break" : ch.risky ? "risk" : "route",
    ...(ch.breaking ? { level: "high" as const } : ch.risky ? { level: "moderate" as const } : {}),
    ...(ch.file ? { file: ch.file } : {}),
    ...(ch.line ? { line: ch.line } : {}),
  }));
  if (d.changes.length > shown.length) children.push({ label: `… ${d.changes.length - shown.length} more`, icon: "info" });
  children.push(...cycleNodes(d), ...behaviourNodes(behaviour, folder));
  const parts = [c.breaking ? `${c.breaking} breaking` : "nothing breaking", c.risky ? `${c.risky} risky` : "", `${c.total} change(s)`, behaviour.length ? `${behaviour.length} behaviour changed` : ""].filter(Boolean);
  return {
    label: `API surface vs ${baseLabel}`,
    description: parts.join(" · "),
    icon: c.breaking ? "break" : c.risky ? "risk" : "route",
    ...(c.breaking ? { level: "high" as const } : c.risky ? { level: "moderate" as const } : {}),
    children,
  };
}
