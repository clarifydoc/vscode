import * as fs from "fs/promises";
import * as path from "path";
import type { AnalysisSummary } from "./summary";

/**
 * `summary-head.json`: the few-KB headline view the analyzer writes beside
 * `project-summary.json` (last, after the manifest). The status bar and the
 * sidebar's top level read it so they never wait for the full summary.
 * vscode-free, so it is unit-tested directly.
 */

export const HEAD_FILE = "summary-head.json";

export interface TrustedHead {
  summary: AnalysisSummary;
  /** The head's mtime: what a watcher compares to know a write was already seen. */
  mtimeMs: number;
}

const COUNTS: ReadonlyArray<keyof AnalysisSummary["counts"]> = [
  "files", "routes", "links", "traces", "screens", "apiCalls", "entities", "security", "suggestions", "subProjects", "layerViolations", "duplicates",
];

async function mtimeOf(file: string): Promise<number | undefined> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * The head beside `summaryFile`, only when it can be trusted: it exists, is
 * at least as new as the summary (and as an `lsp-enhancement.json` delta, which
 * `lsp-update` writes beside an unchanged summary), and parses. A crash between
 * the writes, an older analyzer writing the summary, or a write caught half-way
 * (it is not atomic) all give undefined — the caller reads the full summary.
 */
export async function readTrustedHead(summaryFile: string): Promise<TrustedHead | undefined> {
  const dir = path.dirname(summaryFile);
  const headFile = path.join(dir, HEAD_FILE);
  const [head, summary, delta] = await Promise.all([
    mtimeOf(headFile),
    mtimeOf(summaryFile),
    mtimeOf(path.join(dir, "lsp-enhancement.json")),
  ]);
  if (head === undefined || summary === undefined || head < summary || (delta !== undefined && head < delta)) return undefined;
  try {
    const j = JSON.parse(await fs.readFile(headFile, "utf8"));
    if (j?.schemaVersion !== 1 || !j.counts || !Array.isArray(j.frameworks)) return undefined;
    const counts = {} as AnalysisSummary["counts"];
    for (const k of COUNTS) {
      if (typeof j.counts[k] !== "number") return undefined;
      counts[k] = j.counts[k];
    }
    return {
      mtimeMs: head,
      summary: {
        projectRoot: j.projectRoot,
        analyzedAt: j.analyzedAt,
        frameworks: j.frameworks.map((f: any) => ({ name: String(f?.name ?? f), confidence: f?.confidence, detectedVia: f?.detectedVia })),
        health: j.health && typeof j.health.score === "number" ? { score: j.health.score, grade: String(j.health.grade) } : undefined,
        counts,
      },
    };
  } catch {
    return undefined;
  }
}

/**
 * The headline numbers: the trusted head when there is one, else whatever
 * `full` reads (the whole summary). `full` is not called when the head is used.
 */
export async function headlineFrom(
  summaryFile: string,
  full: () => Promise<AnalysisSummary | undefined>,
): Promise<AnalysisSummary | undefined> {
  return (await readTrustedHead(summaryFile))?.summary ?? full();
}
