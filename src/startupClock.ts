/**
 * `[startup]` milestones in the output channel, each logged once per window
 * with the time since activation began: how long a window takes to show the
 * existing analysis. Also read by the startup test (`startupStats`).
 */
import { monitorEventLoopDelay } from "perf_hooks";

let origin = 0;
let log: (message: string) => void = () => {};
const reached = new Map<string, number>();

export function startClock(at: number, sink: (message: string) => void): void {
  origin = at;
  log = sink;
  reached.clear();
}

/** The first time `milestone` is reached: logged with `detail`, later calls ignored. */
export function milestone(name: string, detail?: string): void {
  if (reached.has(name)) return;
  const ms = Math.round(performance.now() - origin);
  reached.set(name, ms);
  log(`[startup] ${name} at ${ms} ms${detail ? ` (${detail})` : ""}`);
}

/** Each milestone reached so far, in ms since activation began. */
export function milestones(): Record<string, number> {
  return Object.fromEntries(reached);
}

/**
 * The longest the extension-host thread was blocked in the first `forMs`:
 * while it is, no extension answers a hover or a completion. Reported to
 * `done` once, in ms.
 */
export function watchPauses(forMs: number, done: (longestMs: number) => void): { dispose(): void } {
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const timer = setTimeout(() => {
    delay.disable();
    done(Math.round(delay.max / 1e6));
  }, forMs);
  return { dispose: () => (clearTimeout(timer), delay.disable()) };
}
