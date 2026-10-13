/**
 * Calls into and out of one function, from the links the analyzer resolved —
 * what the call hierarchy shows. Pure, no `vscode`.
 */
import type { FileFacts, SymbolLink } from "./analysisData";

/** Relations that are calls. A `reference` names a function without calling
 *  it, and `implements` is a type relation, not a call. */
const CALL_RELATIONS = new Set([undefined, "calls", "instantiates", "http", "mq", "dispatch"]);

export function isCall(link: SymbolLink): boolean {
  return CALL_RELATIONS.has(link.relation) && !link.sourceSymbol.startsWith("(") && link.sourceSymbol !== "";
}

/** The other end of a set of calls, with the lines of the call sites. */
export interface CallEdge {
  file: string;
  symbol: string;
  /** For an outgoing call, the callee's line; for incoming, unknown here. */
  line?: number;
  /** Call-site lines (1-based) — in the caller's file for incoming calls, in
   *  this file for outgoing ones. */
  sites: number[];
  /** The links themselves, for provenance. */
  links: SymbolLink[];
}

function group(links: SymbolLink[], end: (l: SymbolLink) => { file: string; symbol: string; line?: number }): CallEdge[] {
  const out = new Map<string, CallEdge>();
  for (const l of links) {
    const e = end(l);
    const key = `${e.file}\0${e.symbol}`;
    let edge = out.get(key);
    if (!edge) out.set(key, (edge = { ...e, sites: [], links: [] }));
    if (!edge.sites.includes(l.sourceLine)) edge.sites.push(l.sourceLine);
    edge.links.push(l);
  }
  for (const edge of out.values()) edge.sites.sort((a, b) => a - b);
  return [...out.values()];
}

/** Who calls `symbol`, defined in the file these facts describe. */
export function incomingCalls(facts: FileFacts, symbol: string): CallEdge[] {
  return group(
    facts.inbound.filter((l) => l.targetSymbol === symbol && isCall(l)),
    (l) => ({ file: l.sourceFile, symbol: l.sourceSymbol }),
  );
}

/** What `symbol`, defined in the file these facts describe, calls. */
export function outgoingCalls(facts: FileFacts, symbol: string): CallEdge[] {
  return group(
    facts.outbound.filter((l) => l.sourceSymbol === symbol && isCall(l)),
    (l) => ({ file: l.targetFile, symbol: l.targetSymbol, line: l.targetLine }),
  );
}

/** How a set of links was made, in a few words: the weakest confidence and the strategies. */
export function edgeDetail(links: SymbolLink[]): string {
  const order = ["AMBIGUOUS", "INFERRED", "EXTRACTED"];
  const confidences = links.map((l) => l.confidence).filter((c): c is string => !!c);
  const weakest = order.find((c) => confidences.includes(c));
  const strategies = [...new Set(links.map((l) => l.strategy).filter(Boolean))];
  return [weakest?.toLowerCase(), strategies.join(", ")].filter(Boolean).join(" · ");
}
