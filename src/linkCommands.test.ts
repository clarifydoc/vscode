import { describe, expect, it } from "vitest";
import { linkCommands, type FileIndex } from "./analysisData";

const idx = (callers: { file: string; symbol: string }[]): FileIndex => ({
  defs: [],
  callers: new Map([["save", callers.map((c, i) => ({ ...c, line: i + 1 }))]]),
  callees: new Map(),
});
const def = { symbol: "save", kind: "function" as const, line: 3 };
const isTest = (f: string) => f.includes(".test.");

describe("caller lens with tests", () => {
  it("counts the distinct test functions among the callers", () => {
    const i = idx([
      { file: "src/api.ts", symbol: "post" },
      { file: "src/repo.test.ts", symbol: "it saves" },
      { file: "src/repo.test.ts", symbol: "it saves" },
    ]);
    expect(linkCommands(i, def, "u", { isTest, hasTests: true, flagUntested: false })[0]!.title).toBe("$(arrow-left) 3 callers · 1 test");
  });

  it("says a complex function has no test caller only where the project has tests", () => {
    const i = idx([{ file: "src/api.ts", symbol: "post" }]);
    expect(linkCommands(i, def, "u", { isTest, hasTests: true, flagUntested: true })[0]!.title).toBe("$(arrow-left) 1 caller · no test caller");
    expect(linkCommands(i, def, "u", { isTest, hasTests: false, flagUntested: true })[0]!.title).toBe("$(arrow-left) 1 caller");
    expect(linkCommands(i, def, "u", { isTest, hasTests: true, flagUntested: false })[0]!.title).toBe("$(arrow-left) 1 caller");
    expect(linkCommands(i, def, "u")[0]!.title).toBe("$(arrow-left) 1 caller");
  });
});
