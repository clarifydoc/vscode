import * as fs from "fs/promises";
import { summaryPath } from "./paths";
import * as vscode from "vscode";

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
 * The set of project-relative file paths in the latest analysis (the on-disk
 * `files[]` registry). Used to tell whether a given editor file was actually
 * analyzed before we try to deep-link to it.
 */
export async function readFileRegistry(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
): Promise<Set<string> | undefined> {
  try {
    const j = JSON.parse(await fs.readFile(summaryPath(context, folder), "utf8"));
    return Array.isArray(j.files) ? new Set<string>(j.files) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the on-disk project summary. The artifact is normalized
 * (schemaVersion 2), but every field we surface here is either a scalar or an
 * array whose *length* is meaningful regardless of the page_id encoding — so we
 * never need to denormalize.
 */
export async function readSummary(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
): Promise<AnalysisSummary | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(summaryPath(context, folder), "utf8");
  } catch {
    return undefined;
  }

  let j: any;
  try {
    j = JSON.parse(raw);
  } catch {
    return undefined;
  }

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
