import { describe, expect, it } from "vitest";
import { thinFileNote, thinMapNotes } from "./thinMap";
import { thinFilesOf } from "./analysisData";

describe("thinMapNotes", () => {
  it("names the server or frontend framework the map shows nothing of", () => {
    expect(thinMapNotes({
      files: 40,
      routes: 0,
      screens: 0,
      packages: [
        { name: "express", category: "framework", scope: "prod", used: true },
        { name: "react", category: "frontend", scope: "prod" },
        { name: "vitest", category: "testing", scope: "dev" },
      ],
    })).toEqual(["express is a dependency, yet no API route was found", "react is a dependency, yet no screen was found"]);
  });

  it("says nothing when the map has what the dependencies promise, or they are dev-only or unused", () => {
    const packages = [
      { name: "express", category: "framework", scope: "prod" },
      { name: "react", category: "frontend", scope: "dev" },
      { name: "koa", category: "framework", scope: "prod", used: false },
    ];
    expect(thinMapNotes({ files: 10, routes: 3, screens: 0, packages })).toEqual([]);
  });

  it("says when nothing was analyzed at all", () => {
    expect(thinMapNotes({ files: 0, routes: 0, screens: 0, packages: [] })[0]).toMatch(/no source file/);
  });
});

describe("thinFileNote", () => {
  it("says why answers about a file may be incomplete, or nothing", () => {
    expect(thinFileNote({ parseRatio: 0.234, unresolvedImports: 2, totalImports: 5 })).toBe(
      "ClarifyDoc's map is thin here: 23% of it is syntax the parser could not follow; 2 of its 5 relative imports resolve to no file. A missing caller, route or link in this file may be a blind spot, not a fact.",
    );
    expect(thinFileNote({ parseRatio: 0.001 })).toMatch(/^ClarifyDoc's map is thin here: 1% of it/);
    expect(thinFileNote({ unresolvedImports: 1, totalImports: 1 })).toMatch(/its one relative import resolves to no file/);
    expect(thinFileNote({ unresolvedImports: 1, totalImports: 3 })).toMatch(/1 of its 3 relative imports resolves to no file/);
    expect(thinFileNote(undefined)).toBeNull();
    expect(thinFileNote({})).toBeNull();
  });
});

describe("thinFilesOf", () => {
  it("merges the coverage lists by file", () => {
    const m = thinFilesOf({ parseErrors: { worst: [{ file: "a.ts", ratio: 0.2, nodes: 3 }] }, imports: { worst: [{ file: "a.ts", unresolved: 1, total: 4 }, { file: "b.ts", unresolved: 2, total: 2 }] } });
    expect(Object.fromEntries(m)).toEqual({ "a.ts": { parseRatio: 0.2, unresolvedImports: 1, totalImports: 4 }, "b.ts": { unresolvedImports: 2, totalImports: 2 } });
    expect(thinFilesOf(undefined).size).toBe(0);
  });
});

describe("riskyFilesOf", () => {
  it("keeps the files rated high or critical to change", async () => {
    const { riskyFilesOf } = await import("./analysisData.js");
    const v = (level: string) => ({ category: "edge", level, summary: "s", behaviourAtRisk: [], reasons: ["r"] });
    const m = riskyFilesOf([{ filePath: "a.ts", verdict: v("high") }, { filePath: "b.ts", verdict: v("medium") }, { filePath: "c.ts", verdict: v("critical") }, { filePath: "d.ts" }]);
    expect([...m.keys()]).toEqual(["a.ts", "c.ts"]);
    expect(riskyFilesOf(undefined).size).toBe(0);
  });
});
