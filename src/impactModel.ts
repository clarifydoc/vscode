/**
 * The impact of the working-tree changes as a tree: what the Source Control
 * view shows. Pure, no `vscode` — `impactView.ts` turns nodes into items.
 */

/** `clarifydoc impact --json` (the analyzer's ImpactDiffResult), as read here. */
export interface ImpactResult {
  baseLabel: string;
  changedFiles: string[];
  unknownFiles: string[];
  screens: { name: string; file: string; route: string | null }[];
  screenCount: number;
  routes: { method: string | null; path: string; file: string; line: number }[];
  routeCount: number;
  entities: string[];
  entityCount: number;
  queues: string[];
  queueCount: number;
  truncated: boolean;
  tests: string[];
  testCount: number;
  chains: { path: string[]; endsAt: "screen" | "route" }[];
  risk: { level: "low" | "moderate" | "high"; reasons: string[] };
  /** Files that usually change with a changed one but are not in this change (git history). */
  missingCoChanges?: { file: string; with: string; count: number; score: number; hidden?: boolean }[];
  /** CODEOWNERS owners of the changed files. */
  owners?: { owner: string; files: number }[];
  /** Who knows the changed files best, by commits (the change's author left out). */
  reviewers?: { name: string; files: number; commits: number }[];
  /** The change at the level of functions, when the diff's lines were known. */
  symbolImpact?: {
    changed: { file: string; symbol: string; line: number; endLine: number }[];
    direct: SymbolCaller[];
    transitive: SymbolCaller[];
    /** Callers that are route handlers, by their route. */
    routes?: { route: string; file: string; line: number; depth: number; confidence: string }[];
    reviewOnly: string[];
    signatureChanges?: { file: string; symbol: string; line: number; kind: "removed" | "arity"; before?: number; after?: number; callers: number; breaking: boolean }[];
  };
}

export interface SymbolCaller {
  file: string;
  symbol: string;
  line: number;
  depth: number;
  confidence: string;
}

export type ImpactIcon = "risk" | "route" | "screen" | "data" | "queue" | "test" | "file" | "unknown" | "chain" | "info" | "cochange" | "person" | "break" | "caller" | "function";

export interface ImpactNode {
  label: string;
  description?: string;
  icon: ImpactIcon;
  /** Opens this file (project-relative) at `line` when clicked. */
  file?: string;
  line?: number;
  children?: ImpactNode[];
  /** For the risk node: its level, to color it. */
  level?: ImpactResult["risk"]["level"];
}

/** "3" or "3+" when the analyzer capped the list it counted from. */
function count(n: number, truncated: boolean): string {
  return `${n}${truncated ? "+" : ""}`;
}

/** The tree for one impact result. Empty sections are left out. */
export function impactNodes(r: ImpactResult): ImpactNode[] {
  if (r.changedFiles.length === 0 && r.unknownFiles.length === 0) {
    return [{ label: "No changes against the last commit", icon: "info" }];
  }
  const out: ImpactNode[] = [];
  out.push({
    label: `Risk: ${r.risk.level}`,
    icon: "risk",
    level: r.risk.level,
    children: r.risk.reasons.map((reason) => ({ label: reason, icon: "info" })),
  });
  const section = (label: string, total: number, icon: ImpactIcon, children: ImpactNode[]) => {
    if (children.length) out.push({ label, description: count(total, r.truncated), icon, children });
  };
  // Function level, when the diff's lines were known: what breaks first.
  const si = r.symbolImpact;
  if (si) {
    const sig = si.signatureChanges ?? [];
    section(
      "Signature changes",
      sig.length,
      "break",
      sig.map((c) => ({
        label: `${c.symbol}()`,
        description: `${c.kind === "removed" ? "removed" : `${c.before} → ${c.after} required parameters`}${c.callers ? ` · ${c.callers} caller${c.callers === 1 ? "" : "s"}` : ""}${c.breaking ? " · breaks them" : ""}`,
        icon: c.breaking ? "break" : "function",
        file: c.file,
        line: c.line,
      })),
    );
    const caller = (c: SymbolCaller): ImpactNode => ({ label: `${c.symbol}()`, description: `${c.file}:${c.line}${c.depth > 1 ? ` · ${c.depth} hops` : ""}${c.confidence !== "EXTRACTED" ? ` · ${c.confidence.toLowerCase()}` : ""}`, icon: "caller", file: c.file, line: c.line });
    // A caller that is a route handler is named by its route.
    const route = (x: NonNullable<typeof si.routes>[number]): ImpactNode => ({ label: x.route, description: `${x.file}:${x.line}${x.depth > 1 ? ` · ${x.depth} hops` : ""}${x.confidence !== "EXTRACTED" ? ` · ${x.confidence.toLowerCase()}` : ""}`, icon: "route", file: x.file, line: x.line });
    const direct = [...(si.routes ?? []).filter((x) => x.depth === 1).map(route), ...si.direct.map(caller)];
    const further = [...(si.routes ?? []).filter((x) => x.depth > 1).map(route), ...si.transitive.map(caller)];
    section("Will break — direct callers", direct.length, "caller", direct);
    section("Likely affected", further.length, "caller", further);
    section("Review — imports it, calls nothing changed", si.reviewOnly.length, "file", si.reviewOnly.map((f) => ({ label: f, icon: "file", file: f })));
  }
  section(
    "API routes",
    r.routeCount,
    "route",
    r.routes.map((x) => ({
      label: [x.method, x.path].filter(Boolean).join(" "),
      description: x.file,
      icon: "route",
      file: x.file,
      line: x.line,
    })),
  );
  section(
    "Screens",
    r.screenCount,
    "screen",
    r.screens.map((s) => ({ label: s.name, description: s.route ?? s.file, icon: "screen", file: s.file })),
  );
  section("Data", r.entityCount, "data", r.entities.map((e) => ({ label: e, icon: "data" })));
  section("Queues", r.queueCount, "queue", r.queues.map((q) => ({ label: q, icon: "queue" })));
  section("Tests to run", r.testCount, "test", r.tests.map((t) => ({ label: t, icon: "test", file: t })));
  // History says these move together; this change moves only one of them.
  const coChanges = (r.missingCoChanges ?? []).filter((c) => !c.hidden);
  section(
    "Usually changed with",
    coChanges.length,
    "cochange",
    coChanges.map((c) => ({ label: c.file, description: `with ${c.with} · ${c.count}×`, icon: "cochange", file: c.file })),
  );
  const people: ImpactNode[] = [
    ...(r.owners ?? []).map((o) => ({ label: o.owner, description: `owns ${o.files} changed file${o.files === 1 ? "" : "s"} (CODEOWNERS)`, icon: "person" as const })),
    ...(r.reviewers ?? []).map((x) => ({ label: x.name, description: `${x.commits} commit${x.commits === 1 ? "" : "s"} to ${x.files} of these files`, icon: "person" as const })),
  ];
  if (people.length) out.push({ label: "Reviewers", description: String(people.length), icon: "person", children: people });
  out.push({
    label: "Changed files",
    description: String(r.changedFiles.length),
    icon: "file",
    children: r.changedFiles.map((f) => ({
      label: f,
      icon: "file",
      file: f,
      children: [
        // The functions the change touched in this file.
        ...(r.symbolImpact?.changed ?? []).filter((c) => c.file === f).map((c) => ({ label: `${c.symbol}()`, description: `lines ${c.line}–${c.endLine}`, icon: "function" as const, file: c.file, line: c.line })),
        // How this change reaches a screen or route, one sample path each.
        ...r.chains
          .filter((c) => c.path[0] === f && c.path.length > 1)
          .map((c) => ({ label: c.path.slice(1).join(" → "), description: `reaches a ${c.endsAt}`, icon: "chain" as const })),
      ],
    })),
  });
  if (r.unknownFiles.length) {
    out.push({
      label: "Not in the analysis",
      description: String(r.unknownFiles.length),
      icon: "unknown",
      children: r.unknownFiles.map((f) => ({ label: f, icon: "unknown", file: f })),
    });
  }
  return out;
}
