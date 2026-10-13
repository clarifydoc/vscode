import * as vscode from "vscode";
import { LineTracker } from "./lineTracker";

/**
 * Services shared across commands, wired up once in `activate`. Passing this
 * around keeps the individual feature modules decoupled from each other.
 */
export interface ExtensionState {
  context: vscode.ExtensionContext;
  output: vscode.LogOutputChannel;
  /** Edits since the last analysis, for keeping line-anchored views in place. */
  lines: LineTracker;
  /** Refresh the sidebar tree + status bar after an analysis. */
  refresh(): void;
  /** True while an analysis is running for the given folder path. */
  isRunning(folderPath: string): boolean;
  setRunning(folderPath: string, running: boolean): void;
  /** Fires after an analysis completes (or the active analysis set changes) so
   *  data-driven providers (diagnostics, CodeLens, hover, tree) can refresh. */
  readonly onAnalysisChanged: vscode.Event<void>;
  /** Notify listeners that on-disk analysis data changed. */
  fireAnalysisChanged(): void;
}
