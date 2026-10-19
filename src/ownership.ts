import type { FileHistory } from "./analysisData";

/**
 * Who to ask about a file, as one hover line: its CODEOWNERS owners, the
 * people who made most of its commits, and a warning when one person holds
 * most of what is known about it. Null when the analysis read no history for
 * it. Pure — `hover.ts` renders it.
 */
export function ownershipLine(file: string, history: FileHistory | undefined): string | null {
  if (!history) return null;
  const owners = history.ownersOf?.(file) ?? [];
  const churn = history.churn.get(file);
  const parts: string[] = [];
  if (owners.length) parts.push(`owned by ${owners.map((o) => `**${escape(o)}**`).join(", ")}`);
  if (churn && churn.commits > 0) {
    const top = (churn.shares?.length ? churn.shares.map((s) => `${escape(s.name)} (${s.commits})`) : churn.authors.map(escape)).slice(0, 2);
    if (top.length) parts.push(`mostly ${top.join(", ")}`);
    // Only worth saying when there is enough history to mean it.
    if (churn.busFactor === 1 && churn.commits >= 5) parts.push("one person made most of its changes");
  }
  return parts.length ? `$(person) ${parts.join(" · ")}` : null;
}

function escape(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}
