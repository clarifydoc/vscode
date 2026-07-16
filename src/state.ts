import * as vscode from "vscode";

/**
 * Services shared across commands, wired up once in `activate`. Passing this
 * around keeps the individual feature modules decoupled from each other.
 */
export interface ExtensionState {
  context: vscode.ExtensionContext;
  output: vscode.OutputChannel;
  /** Refresh the sidebar tree + status bar after an analysis. */
  refresh(): void;
  /** True while an analysis is running for the given folder path. */
  isRunning(folderPath: string): boolean;
  setRunning(folderPath: string, running: boolean): void;
}
