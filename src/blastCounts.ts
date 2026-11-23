/** What the analysis says a change to one file reaches (`blastRadius[]`): exact counts, the nearest paths. */
export interface FileBlast {
  direct: number;
  transitive: number;
  /** Direct dependents first, capped; paths only. */
  paths: string[];
}

/** Paths kept per file, and paths put in the agent pack. */
const KEPT_PATHS = 25;
export const PACK_PATHS = 15;

/** Per-file blast counts from the analysis's `blastRadius`; files nothing depends on are left out. */
export function blastCountsOf(blast: unknown): Map<string, FileBlast> {
  const out = new Map<string, FileBlast>();
  type Row = { filePath?: unknown; directDependents?: unknown; transitiveDependents?: unknown; affectedFiles?: unknown; transitiveFiles?: unknown };
  for (const b of Array.isArray(blast) ? (blast as Row[]) : []) {
    if (typeof b?.filePath !== "string" || typeof b.directDependents !== "number") continue;
    const transitive = typeof b.transitiveDependents === "number" ? b.transitiveDependents : 0;
    if (b.directDependents + transitive <= 0) continue;
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const paths = [...strings(b.affectedFiles), ...strings(b.transitiveFiles)].slice(0, KEPT_PATHS);
    out.set(b.filePath, { direct: b.directDependents, transitive, paths });
  }
  return out;
}

/** Whether a file's blast reaches the threshold; 0 (or less) is off. */
export function blastShows(b: FileBlast | undefined, threshold: number): b is FileBlast {
  return !!b && threshold > 0 && b.direct >= threshold;
}

const files = (n: number) => `${n} file${n === 1 ? "" : "s"}`;

/** The lens title, the count in words. */
export function blastTitle(b: FileBlast): string {
  return `$(flame) a change here reaches ${files(b.direct + b.transitive)}, ${b.direct} directly`;
}

/** The short plain-text pack an agent reads before editing: the file, the count, the nearest dependents by path. */
export function blastPack(file: string, b: FileBlast | undefined): string {
  if (!b) return `Before editing ${file}: the analysis finds no file that depends on it.`;
  const total = b.direct + b.transitive;
  const shown = b.paths.slice(0, PACK_PATHS);
  return [
    `Before editing ${file}: a change here reaches ${files(total)} (${b.direct} directly, ${b.transitive} through them).`,
    `Nearest dependents${shown.length < total ? ` (${shown.length} of ${total})` : ""}:`,
    ...shown.map((p) => `- ${p}`),
    "Check these still work after the change, and run their tests.",
  ].join("\n");
}

