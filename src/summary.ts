export interface FrameworkInfo {
  name: string;
  confidence?: string;
  detectedVia?: string;
}

export interface AnalysisSummary {
  projectRoot?: string;
  analyzedAt?: string;
  frameworks: FrameworkInfo[];
  health?: { score: number; grade: string };
  counts: {
    files: number;
    routes: number;
    links: number;
    traces: number;
    screens: number;
    apiCalls: number;
    entities: number;
    security: number;
    suggestions: number;
    subProjects: number;
    layerViolations: number;
    duplicates: number;
  };
}

function len(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

/**
 * The status bar's view of a project summary, read from the artifact as stored
 * (schemaVersion 2, normalized). Every field here is a scalar or an array whose
 * *length* is meaningful regardless of the page_id encoding, so it needs no
 * denormalizing. Parsed once per summary version by `loadSummary`.
 */
export function summarize(j: any): AnalysisSummary {
  const frameworks: FrameworkInfo[] = Array.isArray(j.detectedFrameworks)
    ? j.detectedFrameworks.map((f: any) => ({
        name: typeof f === "string" ? f : (f?.name ?? String(f)),
        confidence: f?.confidence,
        detectedVia: f?.detectedVia,
      }))
    : [];

  const entities =
    len(j?.entityGraph?.entities) || len(j?.entityGraph?.nodes) || 0;

  return {
    projectRoot: j.projectRoot,
    analyzedAt: j.analyzedAt,
    frameworks,
    health: j.healthScore
      ? { score: j.healthScore.score, grade: j.healthScore.grade }
      : undefined,
    counts: {
      files: len(j.files),
      routes: len(j.routeMap),
      links: len(j.linkGraph),
      traces: len(j.symbolLinks),
      screens: len(j.screens),
      apiCalls: len(j.apiCalls),
      entities,
      security: len(j.securityIssues),
      suggestions: len(j.suggestions),
      subProjects: len(j.subProjects),
      layerViolations: len(j.layerViolations),
      duplicates: len(j.duplicates),
    },
  };
}
