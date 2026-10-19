/**
 * The text of an issue about ClarifyDoc (VSCODE 8.4): what was running, on
 * what, and what the analysis says it could not see — so a report arrives with
 * the facts a maintainer would ask for first. Nothing here names a file, a
 * folder or a route: an issue is public, and the code it is about may not be.
 * The extension only opens the prefilled page; the user reads it, edits it and
 * submits it, or does not.
 *
 * Pure, no `vscode`, so it is unit-tested.
 */

export type IssueKind = "bug" | "gap" | "idea";

export interface IssueFolder {
  /** Undefined when the folder has no analysis yet. */
  analysis?: {
    analyzedAt?: string;
    files: number;
    /** File count by extension, the largest first. */
    languages: Array<[string, number]>;
    frameworks: string[];
    subProjects: number;
    routes: number;
    screens: number;
    apiCalls: number;
    /** Calls the route linker could not place, by reason. */
    unplaced: Record<string, number>;
    /** Files read only in part / with relative imports that resolve to nothing. */
    thin: { parse: number; imports: number };
    /** Frameworks a dependency names that left nothing on the map. */
    notes: string[];
  };
}

export interface IssueInput {
  kind: IssueKind;
  extension: string;
  analyzer?: string;
  editor: string;
  os: string;
  /** `ssh-remote`, `wsl`, `dev-container`, … — where the extension host runs. */
  remote?: string;
  settings: Record<string, string | boolean | number>;
  folders: IssueFolder[];
}

export const ISSUES_URL = "https://github.com/clarifydoc/vscode/issues/new";

/** GitHub refuses very long prefilled URLs; the body is cut well below that. */
const MAX_BODY = 6000;

const TITLES: Record<IssueKind, string> = {
  bug: "Bug: ",
  gap: "Analysis gap: ",
  idea: "Idea: ",
};

const PROMPTS: Record<IssueKind, string[]> = {
  bug: ["**What happened**", "", "", "**What I expected**", "", "", "**Steps to reproduce**", "1. ", ""],
  gap: [
    "**What the analysis missed** (a route, screen, call or table it should have found — the framework and a",
    "short snippet of how the code declares it help most):",
    "",
    "",
  ],
  idea: ["**What I would like to do**", "", "", "**Why it matters**", "", ""],
};

function folderLines(f: IssueFolder, i: number, many: boolean): string[] {
  const head = many ? `**Folder ${i + 1}**` : "**Analysis**";
  const a = f.analysis;
  if (!a) return [`${head}: not analyzed yet`];
  const unplaced = Object.entries(a.unplaced).filter(([, n]) => n > 0);
  return [
    `${head}${a.analyzedAt ? ` (analyzed ${a.analyzedAt.slice(0, 10)})` : ""}`,
    `- ${a.files} files${a.languages.length ? `: ${a.languages.slice(0, 6).map(([ext, n]) => `${ext} ${n}`).join(", ")}` : ""}`,
    `- frameworks: ${a.frameworks.length ? a.frameworks.join(", ") : "none detected"}${a.subProjects > 1 ? ` · ${a.subProjects} sub-projects` : ""}`,
    `- found: ${a.routes} routes, ${a.screens} screens, ${a.apiCalls} API calls`,
    ...(unplaced.length ? [`- calls reaching no route: ${unplaced.map(([r, n]) => `${n} ${r}`).join(", ")}`] : []),
    ...(a.thin.parse || a.thin.imports
      ? [`- thin spots: ${a.thin.parse} files read in part, ${a.thin.imports} with relative imports resolving to no file`]
      : []),
    ...a.notes.map((n) => `- ${n}`),
  ];
}

export function issueReport(input: IssueInput, summary = ""): { title: string; body: string; url: string } {
  const title = TITLES[input.kind] + summary;
  const many = input.folders.length > 1;
  const settings = Object.entries(input.settings).map(([k, v]) => `${k}=${v}`).join(", ");
  const lines = [
    ...PROMPTS[input.kind],
    "---",
    "**Environment**",
    `- ClarifyDoc extension ${input.extension}${input.analyzer ? ` · analyzer ${input.analyzer}` : ""}`,
    `- ${input.editor} · ${input.os}${input.remote ? ` · remote: ${input.remote}` : ""}`,
    ...(settings ? [`- settings: ${settings}`] : []),
    "",
    ...input.folders.flatMap((f, i) => [...folderLines(f, i, many), ""]),
    "_Filled in by the extension. It names no file, folder or route; edit anything before you submit._",
  ];
  let body = lines.join("\n");
  if (body.length > MAX_BODY) body = body.slice(0, MAX_BODY) + "\n…(cut)";
  return { title, body, url: `${ISSUES_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}` };
}

/** File count by extension, the largest first — the shape of a project without its paths. */
export function languageCounts(files: Iterable<string>): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const f of files) {
    const base = f.slice(f.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    const ext = dot > 0 ? base.slice(dot).toLowerCase() : "(none)";
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}
