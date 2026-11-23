import { describe, it, expect } from "vitest";
import { decisionSections } from "./decisionsHover";
import { escapeMd } from "./markdown";
import type { FileDecisions } from "./analysisData";

const open = (file: string, line: number | undefined, label: string) => `[${label}](open:${file}${line ? `:${line}` : ""})`;
const at = (d: string) => Date.parse(d);

const decisions: FileDecisions = {
  docs: [
    { path: "docs/adr/0001-club-store.md", kind: "decision", title: "Clubs live in Postgres", status: "Accepted", staleness: { governs: ["src/clubs.ts"], changedSince: [], writtenAt: at("2026-03-01") } },
    { path: "docs/adr/0002-match-day.md", kind: "decision", title: "Match day is UTC", staleness: { governs: ["src/clubs.ts"], changedSince: [{ file: "src/clubs.ts", at: at("2026-05-02") }], writtenAt: at("2026-01-01") } },
  ],
  markers: [{ file: "src/clubs.ts", line: 7, tag: "WHY", text: "a player is never deleted, only released" }],
};

describe("decision hover", () => {
  it("lists the documents on the first line, a current one and a stale one, each linked", () => {
    const [card] = decisionSections(decisions, 0, open);
    expect(card).toContain(`[Clubs live in Postgres](open:docs/adr/0001-club-store.md) _(decision)_ · Accepted — current`);
    expect(card).toContain("[Match day is UTC](open:docs/adr/0002-match-day.md)");
    expect(card).toContain(escapeMd("may be stale: 1 named file committed after it (2026-01-01): src/clubs.ts (2026-05-02)"));
    expect(card).toContain("$(warning) [Match day");
  });

  it("shows a marker's record on its line, and nothing elsewhere", () => {
    const [card] = decisionSections(decisions, 6, open);
    expect(card).toContain("**$(law) WHY** a player is never deleted, only released");
    expect(card).toContain("[Match day is UTC]");
    expect(decisionSections(decisions, 3, open)).toEqual([]);
    expect(decisionSections({ docs: [], markers: [] }, 0, open)).toEqual([]);
  });
});
