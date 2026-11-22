/** The logic behind the sidebar's route and finding actions, kept free of `vscode` so it can be tested. */
import type { RouteInfo, SecurityIssue } from "./analysisData";

const routeLabel = (r: Pick<RouteInfo, "httpMethod" | "path">): string => [r.httpMethod, r.path].filter(Boolean).join(" ");

/** The route rows a finding's `entries` name (`GET /clubs` in a file), each located. */
export function reachingRoutes(routes: RouteInfo[], finding: Pick<SecurityIssue, "entries">): RouteInfo[] {
  const out: RouteInfo[] = [];
  for (const e of finding.entries ?? []) {
    const hit = routes.find((r) => r.filePath === e.file && routeLabel(r) === e.route);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/** The summary row behind a route a lens or tree item stands for (it carries `auth`, `params`, `requestSchema`). */
export function fullRoute(routes: RouteInfo[], r: Pick<RouteInfo, "httpMethod" | "path" | "filePath" | "line">): RouteInfo {
  return routes.find((x) => x.filePath === r.filePath && x.line === r.line && x.path === r.path && x.httpMethod === r.httpMethod) ?? (r as RouteInfo);
}

/** True when the line above `line` (0-based) already carries the suppression comment. */
export function alreadySuppressed(lines: string[], line: number): boolean {
  return line > 0 && /clarifydoc-ignore-next-line/.test(lines[line - 1] ?? "");
}
