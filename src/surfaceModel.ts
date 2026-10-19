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

export function surfaceNode(d: SurfaceDiff, baseLabel: string): ImpactNode {
  const c = d.counts;
  if (c.total === 0) return { label: `API surface vs ${baseLabel}`, description: "no change", icon: "info" };
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
  const parts = [c.breaking ? `${c.breaking} breaking` : "nothing breaking", c.risky ? `${c.risky} risky` : "", `${c.total} change(s)`].filter(Boolean);
  return {
    label: `API surface vs ${baseLabel}`,
    description: parts.join(" · "),
    icon: c.breaking ? "break" : c.risky ? "risk" : "route",
    ...(c.breaking ? { level: "high" as const } : c.risky ? { level: "moderate" as const } : {}),
    children,
  };
}
