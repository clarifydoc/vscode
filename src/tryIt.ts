/**
 * "Try it" on a route: the request a route implies, as REST Client `.http`
 * text or a curl command. Pure text building from the route row — nothing is
 * executed and no server is contacted. Values are placeholders the reader fills in.
 */

/** What the builder reads from a route row (a subset of the analyzer's `routeMap` row). */
export interface TryItRoute {
  httpMethod?: string;
  path: string;
  auth?: { policies?: string[]; roles?: string[]; schemes?: string[]; anonymous?: boolean };
  params?: { name: string; type?: string | null; binding?: string | null }[];
  requestSchema?: SchemaNode;
}

export interface SchemaNode {
  type?: string;
  format?: string;
  enum?: string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  $ref?: string;
}

/** Nesting deeper than this is written as `{}` / `[]`. */
export const BODY_DEPTH = 4;

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

/** A path's parameters (`:id`, `{id}`, `<int:id>`, `[id]`) as `{{id}}` placeholders, and their names. */
export function pathPlaceholders(path: string): { path: string; names: string[] } {
  const names: string[] = [];
  const re = /\{\{[^}]*\}\}|\{([A-Za-z_][\w.-]*)(?::[^}]*)?\}|<(?:\w+:)?([A-Za-z_]\w*)>|\[([A-Za-z_]\w*)\]|(?<=\/):([A-Za-z_]\w*)\??/g;
  const out = path.replace(re, (m, a, b, c, d) => {
    const name = a ?? b ?? c ?? d;
    if (!name) return m;
    if (!names.includes(name)) names.push(name);
    return `{{${name}}}`;
  });
  return { path: out, names };
}

/** A JSON value standing for a schema, with typed placeholders; depth-capped. */
export function skeleton(node: SchemaNode | undefined, depth = 0): unknown {
  if (!node) return {};
  if (node.enum?.length) return node.enum[0];
  switch (node.type) {
    case "string":
      if (node.format === "date-time") return "2024-01-01T00:00:00Z";
      if (node.format === "date") return "2024-01-01";
      if (node.format === "uuid") return "00000000-0000-0000-0000-000000000000";
      return "string";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return depth >= BODY_DEPTH ? [] : [skeleton(node.items, depth + 1)];
    default: {
      if (!node.properties || depth >= BODY_DEPTH) return {};
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node.properties)) out[k] = skeleton(v, depth + 1);
      return out;
    }
  }
}

export interface BuiltRequest {
  method: string;
  /** The path with its parameters as `{{name}}`, then the query placeholders. */
  target: string;
  /** Variables the request uses, in order (path params, query params, auth, header params). */
  variables: string[];
  headers: [string, string][];
  /** The JSON body text, when the route takes one. */
  body?: string;
}

/** The auth header a route's `auth` implies; nothing for an anonymous or unguarded route. */
export function authHeader(auth: TryItRoute["auth"]): { header: [string, string]; variable: string } | undefined {
  if (!auth || auth.anonymous) return undefined;
  const guarded = (auth.policies?.length ?? 0) + (auth.roles?.length ?? 0) + (auth.schemes?.length ?? 0) > 0;
  if (!guarded) return undefined;
  const scheme = (auth.schemes ?? []).join(" ");
  if (/basic/i.test(scheme)) return { header: ["Authorization", "Basic {{credentials}}"], variable: "credentials" };
  if (/api[-_ ]?key/i.test(scheme)) return { header: ["X-API-Key", "{{apiKey}}"], variable: "apiKey" };
  return { header: ["Authorization", "Bearer {{token}}"], variable: "token" };
}

export function buildRequest(route: TryItRoute): BuiltRequest {
  const given = route.httpMethod?.toUpperCase();
  const method = given && given !== "*" && given !== "ANY" ? given : "GET";
  const { path, names } = pathPlaceholders(route.path);
  const variables = [...names];
  const params = route.params ?? [];
  const query = params.filter((p) => p.binding === "query");
  for (const q of query) if (!variables.includes(q.name)) variables.push(q.name);
  const target = path + (query.length ? `?${query.map((q) => `${q.name}={{${q.name}}}`).join("&")}` : "");

  const headers: [string, string][] = [];
  const auth = authHeader(route.auth);
  if (auth) {
    headers.push(auth.header);
    variables.push(auth.variable);
  }
  for (const h of params.filter((p) => p.binding === "header")) {
    headers.push([h.name, `{{${h.name}}}`]);
    if (!variables.includes(h.name)) variables.push(h.name);
  }

  let body: string | undefined;
  const bodyBound = params.some((p) => p.binding === "body" || p.binding === "form");
  if (BODY_METHODS.has(method) && (route.requestSchema || bodyBound)) {
    body = JSON.stringify(skeleton(route.requestSchema), null, 2);
    headers.push(["Content-Type", "application/json"]);
  }
  return { method, target, variables, headers, body };
}

/** REST Client text: file variables, then the request. */
export function httpFileText(route: TryItRoute): string {
  const r = buildRequest(route);
  const lines = ["@baseUrl = http://localhost:3000", ...r.variables.map((v) => `@${v} = `), "", `### ${r.method} ${route.path}`];
  lines.push(`${r.method} {{baseUrl}}${r.target} HTTP/1.1`);
  for (const [k, v] of r.headers) lines.push(`${k}: ${v}`);
  if (r.body !== undefined) lines.push("", r.body);
  return lines.join("\n") + "\n";
}

/** `{{apiKey}}` as the shell variable `$API_KEY`. */
function shellVar(name: string): string {
  return "$" + name.replace(/([a-z\d])([A-Z])/g, "$1_$2").toUpperCase();
}

/** One curl command; each `{{x}}` is a shell variable the reader sets (`BASE_URL`, `ID`, `TOKEN`). */
export function curlText(route: TryItRoute): string {
  const r = buildRequest(route);
  const dq = (s: string) =>
    '"' + s.replace(/(["`\\])/g, "\\$1").replace(/\$/g, "\\$").replace(/\{\{(\w+)\}\}/g, (_m, n: string) => shellVar(n)) + '"';
  // Escaping `$` above also escaped none of our variables: they are inserted after it.
  const parts = [`curl -X ${r.method} ${dq(`{{baseUrl}}${r.target}`)}`];
  for (const [k, v] of r.headers) parts.push(`-H ${dq(`${k}: ${v}`)}`);
  if (r.body !== undefined) parts.push(`-d '${r.body.replace(/'/g, "'\\''")}'`);
  return parts.join(" \\\n  ");
}
