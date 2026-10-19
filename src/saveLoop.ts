/**
 * Whether a folder re-analyzes on save, and how soon (VSCODE-PLAN 1.1).
 * `clarifydoc.analyzeOnSave` is `auto` by default: on where the loop is
 * cheap, judged by how long the folder's last real analysis took — an
 * "up to date" exit says nothing about the cost of a change, so it is never
 * counted. Small folders also wait less after a save.
 *
 * Pure, no `vscode`, so it is unit-tested.
 */

export type SaveLoopSetting = "auto" | "on" | "off";

/** At or below this, `auto` turns the loop on. */
export const AUTO_LIMIT_MS = 5000;
/** At or below this, a save is analyzed after the short debounce. */
const QUICK_MS = 2000;
const SHORT_DEBOUNCE_MS = 1000;
const DEBOUNCE_MS = 2500;

/** The setting as written: the old boolean still means what it meant. */
export function saveLoopSetting(raw: unknown): SaveLoopSetting {
  if (raw === true) return "on";
  if (raw === false) return "off";
  return raw === "on" || raw === "off" ? raw : "auto";
}

export interface SaveLoop {
  on: boolean;
  debounceMs: number;
  /** For the log: why it is on or off. */
  why: string;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function decideSaveLoop(setting: SaveLoopSetting, lastMs: number | undefined): SaveLoop {
  const debounceMs = lastMs !== undefined && lastMs <= QUICK_MS ? SHORT_DEBOUNCE_MS : DEBOUNCE_MS;
  if (setting === "off") return { on: false, debounceMs, why: "analyzeOnSave is off" };
  if (setting === "on") return { on: true, debounceMs, why: "analyzeOnSave is on" };
  if (lastMs === undefined) return { on: false, debounceMs, why: "auto: no timed analysis yet" };
  return lastMs <= AUTO_LIMIT_MS
    ? { on: true, debounceMs, why: `auto: the last analysis took ${secs(lastMs)}` }
    : { on: false, debounceMs, why: `auto: the last analysis took ${secs(lastMs)}, over ${secs(AUTO_LIMIT_MS)} — set analyzeOnSave to "on" to run it anyway` };
}

/** Whether analyzer output reports a run that rebuilt nothing. */
export function isUpToDateRun(output: string): boolean {
  return /^Up to date:/m.test(output);
}
