import { parentPort, workerData } from "worker_threads";
import { pathToFileURL } from "url";
import { indexProjectData } from "./analysisIndex";
import { summarize } from "./summary";

/**
 * Runs on a worker thread (see summaryThread.ts): reads, parses and indexes one
 * analysis with the bundled analyzer, and posts back the headline numbers and
 * the plain-data index — never the whole project. No `vscode` here: a worker
 * has no extension API.
 */
async function main(): Promise<void> {
  const { analyzerIndex, analysisDir } = workerData as { analyzerIndex: string; analysisDir: string };
  const reader = await import(pathToFileURL(analyzerIndex).href);
  const project = await reader.loadReportSummary(analysisDir);
  parentPort!.postMessage({ summary: summarize(project), indexed: indexProjectData(project, reader.buildIndex) });
}

main().catch((err) => parentPort!.postMessage({ error: err instanceof Error ? err.message : String(err) }));
