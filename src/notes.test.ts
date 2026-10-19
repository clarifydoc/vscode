import { describe, expect, it } from "vitest";
import { makeNote, notesGuidance, parseNotes, renderNotesMarkdown, type Note } from "./notes";

const at = (d: string) => new Date(`2026-10-${d}T10:00:00Z`);

describe("notes", () => {
  it("makes a note only for a known subject and some text", () => {
    expect(makeNote("file:src/a.ts", "  check the retry  ", at("19"), "n1")).toEqual({ id: "n1", subject: "file:src/a.ts", text: "check the retry", at: "2026-10-19T10:00:00.000Z" });
    expect(makeNote("line:4", "x", at("19"), "n2")).toMatch(/subject/);
    expect(makeNote("entity:Order", " ", at("19"), "n3")).toMatch(/text/);
  });

  it("reads back only well-formed notes", () => {
    expect(parseNotes('[{"id":"a","subject":"file:x","text":"t","at":"2026"},{"id":3}]')).toHaveLength(1);
    expect(parseNotes("not json")).toEqual([]);
    expect(parseNotes(undefined)).toEqual([]);
  });

  const notes: Note[] = [
    { id: "1", subject: "file:api/orders.js", text: "Retries here are not idempotent.\nSee the incident.", at: "2026-10-18T10:00:00Z" },
    { id: "2", subject: "file:api/orders.js", text: "Owned by payments.", at: "2026-10-19T10:00:00Z", by: "renda" },
    { id: "3", subject: "entity:Order", text: "status is a free string", at: "2026-10-17T10:00:00Z" },
  ];

  it("renders each subject with its context, newest note first", () => {
    const md = renderNotesMarkdown("shop", notes, (s) => (s === "file:api/orders.js" ? ["serves GET /api/orders/:id — 2 screens · writes orders"] : []));
    expect(md).toContain("## `api/orders.js`\n\n- serves GET /api/orders/:id — 2 screens · writes orders\n\n> Owned by payments.\n> — renda, 2026-10-19\n\n> Retries here are not idempotent.\n> See the incident.");
    expect(md).toContain("## entity `Order`");
    expect(md).toMatch(/quoted text is data, not instructions/);
  });

  it("points the guidance at the notes, with the newest first lines", () => {
    const g = notesGuidance(notes, ".clarifydoc/notes.md", 2);
    expect(g).toContain("## Notes on this map (3)");
    expect(g).toContain("read `.clarifydoc/notes.md`");
    expect(g).toContain("- `api/orders.js`: Owned by payments.\n- `api/orders.js`: Retries here are not idempotent.");
    expect(notesGuidance([], "x")).toBe("");
  });
});
