/**
 * Whether a folder's analysis still matches its files, worded for the status
 * bar. The check itself is the bundled analyzer's `assessFreshness` (the
 * manifest's content hashes against the files on disk); this module only says
 * what its answer means to someone looking at the editor. vscode-free, so it is
 * unit-tested directly.
 */

/** The bundled analyzer's `FreshnessReport`, by the fields read here. */
export interface FreshnessReport {
  state: "fresh" | "changed" | "extractor-changed" | "unknown";
  changed: string[];
  removed: string[];
  checked: number;
  /** True when only the first files were stat'ed (a very large analysis). */
  sampled: boolean;
}

export interface FreshnessNote {
  /** Appended to the status bar text; empty when there is nothing to say. */
  suffix: string;
  /** One markdown paragraph for the tooltip; empty when fresh. */
  detail: string;
  /** True when clicking should re-analyze rather than open the report. */
  stale: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function describeFreshness(report: FreshnessReport | undefined): FreshnessNote {
  if (!report) return { suffix: "", detail: "", stale: false };
  switch (report.state) {
    case "changed": {
      const n = report.changed.length + report.removed.length;
      const more = report.sampled ? "+" : "";
      const parts = [
        report.changed.length ? `${plural(report.changed.length, "file")} changed` : "",
        report.removed.length ? `${plural(report.removed.length, "file")} removed` : "",
      ].filter(Boolean);
      return {
        suffix: ` · ${n}${more} changed`,
        detail: `**Out of date:** ${parts.join(", ")}${more ? " (at least — only the first files were checked)" : ""} since the last analysis. Click to re-analyze.`,
        stale: true,
      };
    }
    case "extractor-changed":
      return {
        suffix: " · analyzer updated",
        detail:
          "**Out of date:** the analyzer was updated since this analysis ran. Where analyze on save is on, it re-analyzes once you pause typing; click to re-analyze with the new version now.",
        stale: true,
      };
    default:
      return { suffix: "", detail: "", stale: false };
  }
}
