import { describe, expect, it } from "vitest";
import { filesGraph, type GraphFile } from "./filesGraph";

const link = (sourceFile: string, sourceSymbol: string, targetFile: string, targetSymbol: string) => ({
  sourceFile, sourceSymbol, sourceLine: 1, targetFile, targetSymbol, targetLine: 1,
});

const api: GraphFile = {
  file: "web/src/api.ts",
  defs: [
    { symbol: "getOrder", kind: "function", line: 3 },
    { symbol: "createOrder", kind: "function", line: 9 },
    { symbol: "unused", kind: "function", line: 20 },
  ],
  outbound: [link("web/src/api.ts", "getOrder", "web/src/http.ts", "request"), link("web/src/api.ts", "createOrder", "web/src/http.ts", "request")],
  inbound: [link("web/src/OrderPage.tsx", "OrderPage", "web/src/api.ts", "getOrder")],
  callsRoutes: [
    { source: "web/src/api.ts", sourceLine: 5, method: "GET", url: "/api/orders/${id}", target: "api/orders.js", targetLine: 3, routePath: "/api/orders/:id", confidence: "EXTRACTED" },
  ],
  servesCalls: [],
  routes: [],
};
const orders: GraphFile = {
  file: "api/orders.js",
  defs: [{ symbol: "show", kind: "function", line: 3 }],
  outbound: [],
  inbound: [],
  callsRoutes: [],
  servesCalls: [
    { source: "web/src/api.ts", sourceLine: 5, method: "GET", url: "/api/orders/${id}", target: "api/orders.js", targetLine: 3, routePath: "/api/orders/:id", confidence: "EXTRACTED" },
    { source: "mobile/client.ts", sourceLine: 2, method: "GET", url: "/api/orders/1", target: "api/orders.js", targetLine: 3, routePath: "/api/orders/:id", confidence: "EXTRACTED" },
  ],
  routes: [{ httpMethod: "GET", path: "/api/orders/:id", filePath: "api/orders.js", line: 3, kind: "api" }],
};

describe("filesGraph", () => {
  const g = filesGraph([api, orders]);

  it("groups each file's functions, and draws the route a selected file declares", () => {
    expect(g.functions.mermaid).toContain('subgraph f1["web/src/api.ts"]');
    expect(g.functions.mermaid).toContain('["getOrder"]');
    expect(g.functions.mermaid).toContain('f0r0(["GET /api/orders/:id"]):::route');
  });

  it("folds calls to and from outside files onto those files, counting them", () => {
    expect(g.functions.mermaid).toMatch(/\["web\/src\/http\.ts"\]:::outside/);
    expect(g.functions.mermaid).toMatch(/\["web\/src\/OrderPage\.tsx"\]:::outside/);
  });

  it("places an HTTP call in the function holding its line and joins it to the route, across tiers", () => {
    const getOrder = Object.entries(g.functions.nodes).find(([, n]) => n.file === "web/src/api.ts" && n.line === 3)![0];
    expect(g.functions.mermaid).toContain(`${getOrder} -.->|"GET /api/orders/:id"| f0r0`);
    // The selection's own call is drawn once, from the caller's side; the outside caller reaches the route too.
    expect(g.functions.mermaid.match(/-\.->\|"GET \/api\/orders\/:id"\|/g)).toHaveLength(2);
  });

  it("has a file-level view with counted edges", () => {
    expect(g.files.mermaid).toContain('s1 -->|"2 calls"|');
    expect(g.files.mermaid).toContain('s1 -.->|"GET /api/orders/:id"| s0');
    expect(g.summary).toMatch(/^2 files · .* · 1 HTTP call across tiers$/);
  });

  it("folds functions and outside files past the caps", () => {
    const many: GraphFile = { ...api, defs: Array.from({ length: 40 }, (_, i) => ({ symbol: `fn${i}`, kind: "function" as const, line: i + 1 })) };
    const capped = filesGraph([many], { maxPerFile: 5, maxOutside: 1 });
    expect(capped.functions.mermaid).toContain('"+35 more functions"');
    expect(capped.functions.mermaid).toContain('xrest["+2 more files"]:::outside');
  });

  it("draws an HTTP hop once, from the route link, and leaves out import back-edges", () => {
    const hop = { ...link("web/src/api.ts", "getOrder", "api/orders.js", "show"), strategy: "api-route" };
    const ref = { ...link("web/src/api.ts", "<setup>", "web/src/types.ts", "Order"), relation: "reference" };
    const g2 = filesGraph([{ ...api, outbound: [...api.outbound, hop, ref] }, orders]);
    expect(g2.files.mermaid).not.toMatch(/s1 -->[^\n]*s0/);
    expect(g2.files.mermaid).not.toContain("types.ts");
  });

  it("draws a route running its handler from the route node, and drops links into route anchors", () => {
    const runs = link("api/orders.js", "route:GET /api/orders/:id", "api/orders.js", "show");
    const into = link("web/src/api.ts", "getOrder", "api/orders.js", "route:GET /api/orders/:id");
    const g3 = filesGraph([{ ...api, outbound: [into] }, { ...orders, outbound: [runs] }]);
    expect(g3.functions.mermaid).toMatch(new RegExp(`f0r0 --> f0n\\d`));
    expect(g3.functions.mermaid).not.toMatch(/f1n\d --> f0r0/);
  });

  it("keeps labels from breaking out of their quotes", () => {
    const odd = filesGraph([{ ...api, file: 'a"b<c>.ts', outbound: [], inbound: [], callsRoutes: [] }]);
    expect(odd.functions.mermaid).toContain('["a#quot;b#lt;c#gt;.ts"]');
  });
});
