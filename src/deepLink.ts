/**
 * The report's deep link — `#<tab>[/<section>][~<file>[::<symbol>]]` — as the
 * extension builds and reads it, and the mapping from a cursor line to the
 * function it sits in. Pure (no `vscode`), so tests run it directly. The viewer
 * parses the same form (`report/deep-link.ts`); the two are held equal by a test.
 *
 * `<file>` is percent-encoded and so never holds a raw `:`; `::` after it starts
 * a symbol, also encoded: a function as the analysis spells it (`Club.save`) or a
 * route as `route:<METHOD> <path>`.
 */

/** The link to a tab focused on a file, a function in it or a route in it. */
export function reportLink(tab: string, file: string, symbol?: string): string {
  return `${tab}~${encodeURIComponent(file)}${symbol ? `::${encodeURIComponent(symbol)}` : ""}`;
}

/** The symbol a route link names, as the report spells a route's anchor. */
export function routeSymbol(route: { httpMethod?: string | null; path: string }): string {
  return `route:${route.httpMethod || "USE"} ${route.path}`;
}

/** The pieces of a link: its tab, file and symbol (decoded). Mirrors the viewer's `parseDeepLink`. */
export function parseReportLink(raw0: string): { tab: string; section: string | null; file: string | null; symbol: string | null } {
  const raw = raw0.replace(/^#/, "");
  const tilde = raw.indexOf("~");
  const head = tilde === -1 ? raw : raw.slice(0, tilde);
  const decode = (s: string): string => {
    try { return decodeURIComponent(s); } catch { return s; }
  };
  let file: string | null = null;
  let symbol: string | null = null;
  if (tilde !== -1) {
    let tail = raw.slice(tilde + 1);
    const sep = tail.indexOf("::");
    if (sep !== -1) {
      symbol = decode(tail.slice(sep + 2)) || null;
      tail = tail.slice(0, sep);
    }
    file = decode(tail) || null;
  }
  const slash = head.indexOf("/");
  return { tab: slash === -1 ? head : head.slice(0, slash), section: slash === -1 ? null : head.slice(slash + 1) || null, file, symbol };
}

/** A definition as the per-file index lists it: 1-based start, and end where the analysis states it. */
export interface SpanDef {
  symbol: string;
  kind: "function" | "class";
  line: number;
  endLine?: number;
}

/**
 * The function the cursor is in: of the functions whose span holds `line`, the
 * innermost (the one that starts last). A function with no stated end holds
 * every line after its start up to the next function's. `toLine` maps an
 * analyzed (1-based) line to where it is now (0-based) — edits since the
 * analysis move it — or undefined when that line was deleted; `line` is 0-based.
 */
export function functionAtLine(defs: readonly SpanDef[], line: number, toLine: (analyzedLine: number) => number | undefined): string | undefined {
  let best: { symbol: string; start: number } | undefined;
  for (const d of defs) {
    if (d.kind !== "function") continue;
    const start = toLine(d.line);
    if (start === undefined || start > line) continue;
    if (d.endLine !== undefined) {
      const end = toLine(d.endLine);
      if (end !== undefined && end < line) continue;
    }
    if (!best || start >= best.start) best = { symbol: d.symbol, start };
  }
  return best?.symbol;
}
