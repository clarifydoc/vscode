import { describe, it, expect } from "vitest";
import * as path from "path";
import { editorPassActive, runDefinitionPass, targetsOf, withEditorPass, type DefinitionQuery, type ProviderLocation } from "./editorLspCore";

const root = path.resolve("/work/shop");
const at = (file: string, line: number): ProviderLocation => ({ uri: { fsPath: path.join(root, file) }, range: { start: { line } } });
const q = (file: string, line: number, language = "typescript"): DefinitionQuery => ({ file, line, column: 4, callName: "save", language });
const limits = { maxQueries: 100, deadlineMs: 60_000, concurrency: 2, perQueryMs: 50, maxTimeoutsInARow: 2 };

describe("targetsOf", () => {
  it("keeps project files as posix paths with 1-based lines, and drops what lies outside", () => {
    const link: ProviderLocation = { targetUri: { fsPath: path.join(root, "src", "b.ts") }, targetRange: { start: { line: 2 } }, targetSelectionRange: { start: { line: 4 } } };
    expect(targetsOf([at("src/a.ts", 9), link, { uri: { fsPath: path.resolve("/usr/lib/node_modules/x.d.ts") }, range: { start: { line: 0 } } }], root)).toEqual([
      { file: "src/a.ts", line: 10 },
      { file: "src/b.ts", line: 5 },
    ]);
    expect(targetsOf(undefined, root)).toEqual([]);
  });
});

describe("runDefinitionPass", () => {
  it("answers in query order, records an empty answer, and leaves a failure out", async () => {
    const queries = [q("a.ts", 1), q("b.ts", 2), q("c.ts", 3)];
    const r = await runDefinitionPass(queries, async (x) => {
      if (x.file === "b.ts") return [];
      if (x.file === "c.ts") throw new Error("server died");
      return [at("lib/db.ts", 6)];
    }, root, limits);
    expect(r.answers).toEqual([
      { file: "a.ts", line: 1, column: 4, targets: [{ file: "lib/db.ts", line: 7 }] },
      { file: "b.ts", line: 2, column: 4, targets: [] },
    ]);
    expect(r).toMatchObject({ asked: 3, answered: 1, languages: ["typescript"] });
  });

  it("stops at the budget and gives up on a language that keeps timing out", async () => {
    const queries = [q("j1.java", 1, "java"), q("j2.java", 2, "java"), q("j3.java", 3, "java"), q("a.ts", 4), q("b.ts", 5)];
    const r = await runDefinitionPass(
      queries,
      (x) => (x.language === "java" ? new Promise(() => {}) : Promise.resolve([at("x.ts", 0)])),
      root,
      { ...limits, concurrency: 1, maxQueries: 4 },
    );
    expect(r.gaveUp).toEqual(["java"]);
    expect(r.timeouts).toBe(2);
    expect(r.answers.map((a) => a.file)).toEqual(["a.ts"]);
    expect(r.stopped).toBe("budget");
  });

  it("stops when cancelled or past the deadline", async () => {
    let calls = 0;
    const cancelled = await runDefinitionPass([q("a.ts", 1), q("b.ts", 2)], async () => [at("x.ts", 0)], root, limits, () => ++calls > 1);
    expect(cancelled.stopped).toBe("cancelled");
    let t = 0;
    const late = await runDefinitionPass([q("a.ts", 1), q("b.ts", 2)], async () => [at("x.ts", 0)], root, { ...limits, concurrency: 1, deadlineMs: 10 }, () => false, () => (t += 8));
    expect(late.stopped).toBe("deadline");
    expect(late.asked).toBe(1);
  });

  it("asks again what a server said nothing to while it was still starting", async () => {
    let warm = false;
    const queries = [q("a.ts", 1), q("b.ts", 2), q("c.ts", 3), q("x.py", 4, "python")];
    const r = await runDefinitionPass(queries, async (x) => {
      if (x.language === "python") return [];
      if (x.file === "c.ts") warm = true;
      return warm ? [at("lib/db.ts", 0)] : [];
    }, root, { ...limits, concurrency: 1 });
    // a.ts and b.ts came back empty before the server's first answer; python never answered, so is not retried.
    expect(r.retried).toBe(2);
    expect(r.answers.map((a) => [a.file, a.targets.length])).toEqual([["a.ts", 1], ["b.ts", 1], ["c.ts", 1], ["x.py", 0]]);
    expect(r.answered).toBe(3);
  });

  it("mutes ClarifyDoc's own providers while it runs", async () => {
    expect(editorPassActive()).toBe(false);
    await withEditorPass(async () => expect(editorPassActive()).toBe(true));
    expect(editorPassActive()).toBe(false);
  });
});
