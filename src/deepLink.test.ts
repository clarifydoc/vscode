import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { FOLLOW_DELAY_MS, followHash } from "./reportPanel";
import { functionAtLine, parseReportLink, reportLink, routeSymbol, type SpanDef } from "./deepLink";
import { itemReportHash, type Node } from "./treeView";

describe("report links", () => {
  it("builds a file, a function and a route link", () => {
    expect(reportLink("traces", "src/club.ts")).toBe("traces~src%2Fclub.ts");
    expect(reportLink("traces", "src/club.ts", "Club.save")).toBe("traces~src%2Fclub.ts::Club.save");
    expect(reportLink("routes", "src/clubs.ts", routeSymbol({ httpMethod: "GET", path: "/api/v2/clubs/{id}" }))).toBe(
      "routes~src%2Fclubs.ts::route%3AGET%20%2Fapi%2Fv2%2Fclubs%2F%7Bid%7D",
    );
    expect(routeSymbol({ httpMethod: null, path: "/x" })).toBe("route:USE /x");
  });

  it("reads them back, and still reads the older forms", () => {
    expect(parseReportLink("#traces~src%2Fclub.ts::Club.save")).toEqual({ tab: "traces", section: null, file: "src/club.ts", symbol: "Club.save" });
    expect(parseReportLink(reportLink("routes", "a b/c.ts", "route:GET /x y"))).toEqual({ tab: "routes", section: null, file: "a b/c.ts", symbol: "route:GET /x y" });
    expect(parseReportLink("traces~src%2Fclub.ts")).toEqual({ tab: "traces", section: null, file: "src/club.ts", symbol: null });
    expect(parseReportLink("links/data-access~src%2Fa.ts")).toEqual({ tab: "links", section: "data-access", file: "src/a.ts", symbol: null });
    expect(parseReportLink("health/security")).toEqual({ tab: "health", section: "security", file: null, symbol: null });
    // a `~` inside the path stays in the file
    expect(parseReportLink("traces~a~b.ts").file).toBe("a~b.ts");
  });

  it("gives a route's sidebar item the route link, and others the file link", () => {
    const route = { filePath: "src/clubs.ts", httpMethod: "DELETE", path: "/api/v2/clubs/{id}" };
    const node = { file: "src/clubs.ts", route } as unknown as Node;
    expect(itemReportHash(node, "routes")).toBe(reportLink("routes", "src/clubs.ts", "route:DELETE /api/v2/clubs/{id}"));
    expect(itemReportHash(node, "traces")).toBe("traces~src%2Fclubs.ts");
    expect(itemReportHash({ file: "src/a.ts" } as unknown as Node, "routes")).toBe("routes~src%2Fa.ts");
  });
});

describe("function under the cursor", () => {
  const defs: SpanDef[] = [
    { symbol: "Club", kind: "class", line: 1, endLine: 40 },
    { symbol: "Club.save", kind: "function", line: 3, endLine: 12 },
    { symbol: "Club.load", kind: "function", line: 14, endLine: 30 },
    { symbol: "helper", kind: "function", line: 20, endLine: 25 }, // nested in load
    { symbol: "later", kind: "function", line: 50 }, // no stated end
  ];
  const same = (l: number): number => l - 1;
  it("maps a cursor line (0-based) to the function that holds it", () => {
    expect(functionAtLine(defs, 4, same)).toBe("Club.save"); // line 5
    expect(functionAtLine(defs, 2, same)).toBe("Club.save"); // its first line
    expect(functionAtLine(defs, 21, same)).toBe("helper"); // innermost
    expect(functionAtLine(defs, 27, same)).toBe("Club.load"); // after the nested one
  });
  it("is undefined outside every function, and a class is no function", () => {
    expect(functionAtLine(defs, 0, same)).toBeUndefined();
    expect(functionAtLine(defs, 12, same)).toBeUndefined(); // between save and load
    expect(functionAtLine(defs, 60, same)).toBe("later"); // open-ended
  });
  it("follows lines moved by edits since the analysis", () => {
    const shifted = (l: number): number => l - 1 + 10;
    expect(functionAtLine(defs, 14, shifted)).toBe("Club.save");
    expect(functionAtLine(defs, 4, shifted)).toBeUndefined();
    expect(functionAtLine(defs, 4, (l) => (l === 3 ? undefined : l - 1))).toBeUndefined(); // deleted start
  });
});

describe("followHash with a function", () => {
  it("moves Call Traces to the function, other tabs to the file only", () => {
    expect(followHash("traces~src%2Fa.ts", "src/a.ts", "Club.save")).toBe("traces~src%2Fa.ts::Club.save");
    expect(followHash("traces~src%2Fa.ts::Club.save", "src/a.ts", "Club.load")).toBe("traces~src%2Fa.ts::Club.load");
    expect(followHash("ui~src%2Fa.ts", "src/a.ts", "Club.save")).toBeUndefined();
    expect(followHash("ui~src%2Fa.ts", "src/b.ts", "Club.save")).toBe("ui~src%2Fb.ts");
  });
  it("does not reset to the file when the cursor leaves its functions, or repeat itself", () => {
    expect(followHash("traces~src%2Fa.ts::Club.save", "src/a.ts", undefined)).toBeUndefined();
    expect(followHash("traces~src%2Fa.ts::Club.save", "src/a.ts", "Club.save")).toBeUndefined();
    expect(followHash("traces~src%2Fa.ts::Club.save", "src/b.ts", undefined)).toBe("traces~src%2Fb.ts");
  });
  it("leaves a tab that focuses no file alone", () => {
    expect(followHash("routes", "src/a.ts", "Club.save")).toBeUndefined();
  });
});

describe("follow debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("one move after the cursor rests", () => {
    // the same shape registerFollowEditor uses: each event clears the pending timer
    const moved: string[] = [];
    let timer: NodeJS.Timeout | undefined;
    const schedule = (symbol: string): void => {
      clearTimeout(timer);
      timer = setTimeout(() => moved.push(symbol), FOLLOW_DELAY_MS);
    };
    schedule("a"); vi.advanceTimersByTime(FOLLOW_DELAY_MS - 1);
    schedule("b"); vi.advanceTimersByTime(FOLLOW_DELAY_MS - 1);
    schedule("c");
    expect(moved).toEqual([]);
    vi.advanceTimersByTime(FOLLOW_DELAY_MS);
    expect(moved).toEqual(["c"]);
  });
});
