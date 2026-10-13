import { describe, expect, it } from "vitest";
import type { FileFacts, SymbolLink } from "./analysisData";
import { edgeDetail, incomingCalls, outgoingCalls } from "./callGraph";

const link = (over: Partial<SymbolLink>): SymbolLink => ({
  sourceFile: "a.ts",
  sourceSymbol: "caller",
  sourceLine: 1,
  targetFile: "b.ts",
  targetSymbol: "callee",
  targetLine: 10,
  ...over,
});

const facts = (inbound: SymbolLink[], outbound: SymbolLink[]): FileFacts => ({
  complexity: [],
  routes: [],
  security: [],
  inbound,
  outbound,
  apiCalls: [],
  callsRoutes: [],
  servesCalls: [],
});

describe("call graph", () => {
  it("groups incoming calls by calling function, one site per line", () => {
    const f = facts(
      [
        link({ sourceLine: 3, confidence: "EXTRACTED" }),
        link({ sourceLine: 7, confidence: "INFERRED", strategy: "di-binding" }),
        link({ sourceLine: 3 }),
        link({ sourceFile: "c.ts", sourceSymbol: "other", sourceLine: 2 }),
        link({ targetSymbol: "unrelated" }),
      ],
      [],
    );
    const edges = incomingCalls(f, "callee");
    expect(edges.map((e) => [e.file, e.symbol, e.sites])).toEqual([
      ["a.ts", "caller", [3, 7]],
      ["c.ts", "other", [2]],
    ]);
    expect(edgeDetail(edges[0].links)).toBe("inferred · di-binding");
  });

  it("follows an http link across tiers, and skips mere references", () => {
    const f = facts(
      [],
      [
        link({ targetFile: "Api/C.cs", targetSymbol: "C.Get", relation: "http", strategy: "api-route" }),
        link({ sourceSymbol: "caller", targetSymbol: "Type", relation: "reference" }),
        link({ sourceSymbol: "(reference)", targetSymbol: "x" }),
      ],
    );
    expect(outgoingCalls(f, "caller").map((e) => `${e.file}#${e.symbol}:${e.line}`)).toEqual(["Api/C.cs#C.Get:10"]);
  });
});
