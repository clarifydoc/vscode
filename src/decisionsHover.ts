import type { FileDecisions } from "./analysisData";
import { escapeMd } from "./markdown";

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Documents listed in a card before "and N more". */
const SHOWN_DOCS = 5;

type Doc = FileDecisions["docs"][number];
type Marker = FileDecisions["markers"][number];

/** Whether a document is flagged: something it names was committed after it was written. */
export function isStale(d: Doc): boolean {
  return (d.staleness?.changedSince.length ?? 0) > 0;
}

/** "may be stale: 2 files changed since 2026-01-01" / "current" / "" when git cannot say. Words, not colour. */
export function stalenessText(d: Doc): string {
  const s = d.staleness;
  if (!s || s.writtenAt === undefined) return "";
  if (!s.changedSince.length) return "current";
  const eg = s.changedSince.slice(0, 2).map((c) => `${c.file} (${day(c.at)})`).join(", ");
  return `may be stale: ${s.changedSince.length} named file${s.changedSince.length === 1 ? "" : "s"} committed after it (${day(s.writtenAt)}): ${eg}${s.changedSince.length > 2 ? ", …" : ""}`;
}

/** Opens a project file at a line; `label` is the link text. */
export type OpenLink = (file: string, line: number | undefined, label: string) => string;

function docLine(d: Doc, open: OpenLink): string {
  const state = stalenessText(d);
  const icon = isStale(d) ? "$(warning)" : "$(book)";
  const status = d.status ? ` · ${escapeMd(d.status)}` : "";
  return `${icon} ${open(d.path, undefined, d.title)} _(${escapeMd(d.kind)})_${status}${state ? ` — ${escapeMd(state)}` : ""}`;
}

/** The documents that name the file, for a hover on its first line. */
export function documentsSection(decisions: FileDecisions, open: OpenLink): string | undefined {
  if (decisions.docs.length === 0) return undefined;
  const shown = decisions.docs.slice(0, SHOWN_DOCS).map((d) => docLine(d, open));
  const more = decisions.docs.length - shown.length;
  return `**$(law) Decisions about this file**\n\n${shown.join("\n\n")}${more > 0 ? `\n\nand ${more} more` : ""}`;
}

/** A WHY:/DECISION: marker on the hovered line, with the documents it sits beside. */
export function markerSection(m: Marker, decisions: FileDecisions, open: OpenLink): string {
  const docs = decisions.docs.slice(0, SHOWN_DOCS).map((d) => docLine(d, open));
  return `**$(law) ${escapeMd(m.tag)}** ${escapeMd(m.text)}${docs.length ? `\n\nDocuments naming this file:\n\n${docs.join("\n\n")}` : ""}`;
}

/** Hover sections for `line` (0-based): the file's documents on line 0, a marker's record on its line. */
export function decisionSections(decisions: FileDecisions, line: number, open: OpenLink): string[] {
  const out: string[] = [];
  for (const m of decisions.markers.filter((x) => x.line - 1 === line)) out.push(markerSection(m, decisions, open));
  if (line === 0) {
    const docs = documentsSection(decisions, open);
    if (docs) out.push(docs);
  }
  return out;
}
