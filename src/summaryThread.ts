import { Worker } from "worker_threads";
import type { IndexedProject } from "./analysisIndex";
import type { AnalysisSummary } from "./summary";

/** What the worker posts back. */
export interface OffThreadSummary {
  summary: AnalysisSummary;
  indexed: IndexedProject;
}

/**
 * Read, parse and index an analysis on a worker thread (summaryWorker.ts).
 *
 * The extension host is one thread shared by every extension, and a large
 * project's summary is a JSON.parse of 100 MB and more: hundreds of ms in which
 * no extension answers a hover or a completion. On a worker, the host only
 * receives the compact index the views read, which skips the largest parts
 * of the summary (blast radius, reach, the link graph). One worker per read,
 * ended once it has answered, so the parse's garbage goes with it.
 *
 * Rejects when the worker cannot run or fails; the caller then reads on the
 * extension host as before.
 */
export function readSummaryOffThread(workerFile: string, analyzerIndex: string, analysisDir: string): Promise<OffThreadSummary> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile, { workerData: { analyzerIndex, analysisDir } });
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      settle();
    };
    worker.once("message", (m: OffThreadSummary | { error: string }) =>
      finish(() => ("error" in m ? reject(new Error(m.error)) : resolve(m))),
    );
    worker.once("error", (err) => finish(() => reject(err)));
    worker.once("exit", (code) => finish(() => reject(new Error(`the worker exited (${code}) without an answer`))));
  });
}
