/**
 * How a file the analysis rates high or critical to change is marked in the
 * Explorer (V-09): a short badge, a colour and the verdict as its tooltip.
 * Only those two levels are marked — a tree where every file carries a badge
 * says nothing.
 *
 * Pure, no `vscode`, so it is unit-tested.
 */
import type { RiskVerdict } from "./analysisData";

export interface RiskMark {
  badge: string;
  /** A theme colour id: the Explorer tints the file's name with it. */
  color: string;
  tooltip: string;
}

export function riskMark(v: RiskVerdict): RiskMark {
  const critical = v.level === "critical";
  const why = v.reasons.length ? ` — ${v.reasons.slice(0, 3).join("; ")}` : "";
  return {
    badge: critical ? "!!" : "!",
    color: critical ? "charts.red" : "charts.orange",
    tooltip: `ClarifyDoc: ${v.level} risk to change. ${v.summary}${why}`,
  };
}
