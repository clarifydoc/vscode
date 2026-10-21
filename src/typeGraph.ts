/**
 * Supertypes and subtypes from the analyzer's class graph: `extends` and
 * `implements` edges between types declared in the project. Types from
 * outside it (`ControllerBase`, `JpaRepository`) have no file to open, so
 * they are left out. Pure, no `vscode`.
 */

export interface TypeNode {
  /** `file::Name`. */
  id: string;
  name: string;
  file: string;
  isInterface: boolean;
}

export interface TypeEdge {
  node: TypeNode;
  relation: "extends" | "implements";
}

export interface TypeGraph {
  byId: Map<string, TypeNode>;
  supertypes(id: string): TypeEdge[];
  subtypes(id: string): TypeEdge[];
}

/** The part of the class graph `typeGraph` reads, in the class graph's own shape. */
export interface ProjectTypes {
  nodes: { id: string; name?: unknown; filePath: string; isInterface?: boolean }[];
  edges: { source: string; target: string; byKind: { extends?: unknown; implements?: unknown } }[];
}

function isProjectType(n: any): boolean {
  return typeof n?.id === "string" && typeof n?.filePath === "string" && !!n.filePath && !n.isExternal && !n.isFile;
}

function relationOf(e: any): TypeEdge["relation"] | undefined {
  return e?.byKind?.extends ? "extends" : e?.byKind?.implements ? "implements" : undefined;
}

/**
 * The project's own types and the extends/implements edges between them — a
 * small fraction of the class graph, cheap to post from a worker thread.
 */
export function projectTypes(classGraph: unknown): ProjectTypes {
  const g = (classGraph ?? {}) as { nodes?: any[]; edges?: any[] };
  const nodes: ProjectTypes["nodes"] = (g.nodes ?? [])
    .filter(isProjectType)
    .map((n) => ({ id: n.id, name: n.name, filePath: n.filePath, isInterface: !!n.isInterface }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges: ProjectTypes["edges"] = [];
  for (const e of g.edges ?? []) {
    const relation = relationOf(e);
    if (relation && ids.has(e.source) && ids.has(e.target)) edges.push({ source: e.source, target: e.target, byKind: { [relation]: true } });
  }
  return { nodes, edges };
}

export function typeGraph(classGraph: unknown): TypeGraph {
  const g = (classGraph ?? {}) as { nodes?: any[]; edges?: any[] };
  const byId = new Map<string, TypeNode>();
  for (const n of g.nodes ?? []) {
    if (!isProjectType(n)) continue;
    byId.set(n.id, { id: n.id, name: String(n.name ?? n.id.split("::").pop()), file: n.filePath, isInterface: !!n.isInterface });
  }
  const up = new Map<string, TypeEdge[]>();
  const down = new Map<string, TypeEdge[]>();
  const add = (map: Map<string, TypeEdge[]>, key: string, edge: TypeEdge) => {
    const list = map.get(key);
    if (list) list.push(edge);
    else map.set(key, [edge]);
  };
  for (const e of g.edges ?? []) {
    const relation = relationOf(e);
    if (!relation) continue;
    const sub = byId.get(e.source);
    const sup = byId.get(e.target);
    if (!sub || !sup) continue;
    add(up, sub.id, { node: sup, relation });
    add(down, sup.id, { node: sub, relation });
  }
  return {
    byId,
    supertypes: (id) => up.get(id) ?? [],
    subtypes: (id) => down.get(id) ?? [],
  };
}

/** The id the class graph gives a type declared in a file. */
export function typeId(file: string, name: string): string {
  return `${file}::${name}`;
}
