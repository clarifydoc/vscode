import { describe, expect, it } from "vitest";
import { countLineBreaks, LineEdit, shiftLine, shiftLineThrough } from "./lineShift";

const edit = (startLine: number, startCharacter: number, endLine: number, text: string): LineEdit => ({
  startLine,
  startCharacter,
  endLine,
  insertedLines: countLineBreaks(text),
});

describe("shiftLine", () => {
  it("leaves lines before the edit alone", () => {
    expect(shiftLine(3, edit(5, 0, 5, "x\n"))).toBe(3);
  });

  it("keeps a line edited in place", () => {
    expect(shiftLine(5, edit(5, 4, 5, "renamed"))).toBe(5);
    expect(shiftLine(5, edit(5, 0, 5, "x"))).toBe(5);
  });

  it("moves a line down when lines are inserted above or at its start", () => {
    expect(shiftLine(9, edit(5, 0, 5, "a\nb\n"))).toBe(11);
    expect(shiftLine(5, edit(5, 0, 5, "a\n"))).toBe(6);
  });

  it("moves a line up when lines above it are deleted", () => {
    // Delete line 5 entirely: (5,0)-(6,0).
    const del = edit(5, 0, 6, "");
    expect(shiftLine(5, del)).toBeUndefined();
    expect(shiftLine(6, del)).toBe(5);
    expect(shiftLine(10, del)).toBe(9);
  });

  it("drops a line wholly inside a replaced range", () => {
    const replace = edit(5, 2, 7, "x");
    expect(shiftLine(5, replace)).toBe(5);
    expect(shiftLine(6, replace)).toBeUndefined();
    expect(shiftLine(7, replace)).toBe(5);
    expect(shiftLine(8, replace)).toBe(6);
  });

  it("composes edits in order", () => {
    expect(shiftLineThrough(10, [edit(0, 0, 0, "a\n"), edit(3, 0, 5, "")])).toBe(9);
    expect(shiftLineThrough(4, [edit(0, 0, 0, "a\n"), edit(3, 0, 6, "")])).toBeUndefined();
  });
});

describe("countLineBreaks", () => {
  it("counts LF, CRLF and CR once each", () => {
    expect(countLineBreaks("a\nb\r\nc\rd")).toBe(3);
    expect(countLineBreaks("")).toBe(0);
  });
});
