/** One text edit, reduced to what moving a line needs (0-based positions). */
export interface LineEdit {
  startLine: number;
  startCharacter: number;
  endLine: number;
  /** Line breaks in the inserted text. */
  insertedLines: number;
}

/**
 * Where a line's content is after an edit, or undefined when the edit removed
 * it. The analysis numbered lines on the file as it was saved; while the file
 * is edited, findings and lenses follow their line through this instead of
 * staying at a number that now names different code.
 *
 * - before the edit: unchanged;
 * - after it: moved by the lines the edit added or removed;
 * - the edit's first line keeps its place when the edit starts past column 0;
 * - the edit's last line continues where the inserted text ends;
 * - a line strictly inside the replaced range is gone.
 */
export function shiftLine(line: number, edit: LineEdit): number | undefined {
  const { startLine: s, startCharacter, endLine: e, insertedLines: n } = edit;
  if (line < s) return line;
  if (line > e) return line + n - (e - s);
  if (line === s && startCharacter > 0) return s;
  if (line === e) return s + n;
  return undefined;
}

/** Apply edits in the order they happened. */
export function shiftLineThrough(line: number, edits: readonly LineEdit[]): number | undefined {
  let at: number | undefined = line;
  for (const edit of edits) {
    if (at === undefined) return undefined;
    at = shiftLine(at, edit);
  }
  return at;
}

/** Line breaks in a string, counted the way an editor counts lines. */
export function countLineBreaks(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) n++;
    else if (c === 13) {
      n++;
      if (text.charCodeAt(i + 1) === 10) i++;
    }
  }
  return n;
}
