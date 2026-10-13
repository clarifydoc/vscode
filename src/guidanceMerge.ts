/**
 * The ClarifyDoc section of an agent instructions file (AGENTS.md, CLAUDE.md,
 * a Cursor rule), between markers so it can be updated or removed later
 * without touching anything else in the file. Pure, no `vscode`.
 */
export const START = "<!-- clarifydoc:start -->";
export const END = "<!-- clarifydoc:end -->";

/** `existing` with the guidance section added or replaced; a new file when undefined. */
export function mergeGuidance(existing: string | undefined, guidance: string, header = ""): string {
  const block = `${START}\n${guidance.trim()}\n${END}\n`;
  if (existing === undefined || existing.trim() === "") return `${header}${block}`;
  const start = existing.indexOf(START);
  const end = existing.indexOf(END, start);
  if (start >= 0 && end > start) {
    const after = existing.slice(end + END.length).replace(/^\r?\n/, "");
    return existing.slice(0, start) + block + after;
  }
  const sep = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  return existing + sep + block;
}

/** A Cursor rule file around the guidance (always applied). */
export const CURSOR_RULE_HEADER = `---
description: When to use the ClarifyDoc MCP tools
alwaysApply: true
---

`;
