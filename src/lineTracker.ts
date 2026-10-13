import * as vscode from "vscode";
import { countLineBreaks, LineEdit, shiftLineThrough } from "./lineShift";

/**
 * The edits made to each file since the last analysis, so line-anchored views
 * (diagnostics, CodeLens) keep pointing at the code they were computed for
 * while the user types. A new analysis of a folder numbers its lines afresh,
 * so it resets that folder's history (`reset`); until then a closed file's
 * edits are kept too — the analysis still describes the file as it was
 * before them.
 */
export class LineTracker implements vscode.Disposable {
  private readonly edits = new Map<string, LineEdit[]>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  private readonly subscriptions: vscode.Disposable[];

  /** Fires with a file whose lines moved. */
  readonly onDidChange = this.changed.event;

  constructor() {
    this.subscriptions = [
      this.changed,
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.scheme !== "file" || e.contentChanges.length === 0) return;
        const key = e.document.uri.toString();
        const list = this.edits.get(key) ?? [];
        // VS Code reports one event's changes bottom-up, each against the
        // document as it was before the event, so applying them in the given
        // order never moves a later one.
        for (const c of e.contentChanges) {
          list.push({
            startLine: c.range.start.line,
            startCharacter: c.range.start.character,
            endLine: c.range.end.line,
            insertedLines: countLineBreaks(c.text),
          });
        }
        this.edits.set(key, list);
        this.changed.fire(e.document.uri);
      }),
    ];
  }

  /** Forget the edits to files under a folder: it was just analyzed again. */
  reset(folder: vscode.Uri): void {
    const prefix = folder.toString().replace(/\/?$/, "/");
    for (const key of [...this.edits.keys()]) if (key.startsWith(prefix)) this.edits.delete(key);
  }

  /** Where an analyzed (0-based) line is now, or undefined if it was deleted. */
  map(uri: vscode.Uri, line: number): number | undefined {
    const list = this.edits.get(uri.toString());
    return list ? shiftLineThrough(line, list) : line;
  }

  /** Whether a file has been edited since the last analysis. */
  isEdited(uri: vscode.Uri): boolean {
    return this.edits.has(uri.toString());
  }

  dispose(): void {
    for (const s of this.subscriptions) s.dispose();
    this.edits.clear();
  }
}
