/**
 * The analyzer's progress events (`analyze --progress json`, one JSON object
 * per line on stderr) turned into what a VS Code progress notification takes:
 * a message, and an increment of the bar. Analyzing files is most of a run, so
 * it fills the bar to 80%; each later stage adds a step, and the end fills it.
 * No VS Code import: the extension feeds it lines, a test feeds it strings.
 */
export interface ProgressUpdate {
  message?: string;
  /** Percentage points to add to the bar. */
  increment?: number;
}

const FILES_SHARE = 80;
const LATER_STAGES = ["link", "lsp", "advanced", "packages", "write"];
const STAGE_SHARE = (100 - FILES_SHARE) / LATER_STAGES.length;

export class AnalyzeProgress {
  private filled = 0;

  /** Whether a line is a progress event (and so not output to show). */
  static isEvent(line: string): boolean {
    return line.startsWith('{"event":');
  }

  /** The update one event line asks for, or null for one that moves nothing. */
  update(line: string): ProgressUpdate | null {
    let e: { event?: string; stage?: string; label?: string; done?: number; total?: number; filesTotal?: number; upToDate?: boolean };
    try {
      e = JSON.parse(line);
    } catch {
      return null;
    }
    if (e.event === "stage" && e.stage) {
      const message = e.stage === "analyze" && e.filesTotal !== undefined ? `analyzing ${e.filesTotal} files` : e.label?.toLowerCase();
      return { message, ...this.fill(LATER_STAGES.includes(e.stage) ? Math.max(this.filled, FILES_SHARE) + STAGE_SHARE : this.filled) };
    }
    if (e.event === "files" && typeof e.done === "number" && e.total) {
      return { message: `analyzing files ${e.done}/${e.total}`, ...this.fill((e.done / e.total) * FILES_SHARE) };
    }
    if (e.event === "step" && e.label) return { message: e.label.toLowerCase() };
    if (e.event === "done") return { message: e.upToDate ? "up to date" : "done", ...this.fill(100) };
    return null;
  }

  /** Move the bar to `to` percent (never back): the increment that takes. */
  private fill(to: number): { increment?: number } {
    const target = Math.min(100, to);
    if (target <= this.filled) return {};
    const increment = target - this.filled;
    this.filled = target;
    return { increment };
  }
}
