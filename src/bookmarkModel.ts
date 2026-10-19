/**
 * Bookmarked report views (VSCODE-PLAN 5.3): a name for a place in the
 * report — a tab, a Health section, a file focused in a tab — kept per
 * workspace. Pure, no `vscode`, so it is unit-tested.
 */

export interface Bookmark {
  name: string;
  /** The workspace folder's path. */
  folder: string;
  /** The report deep link: `<tab>`, `health/<section>` or `<tab>~<file>`. */
  hash: string;
}

const TAB_NAMES: Record<string, string> = {
  summary: "Overview", routes: "Routes", ui: "Screens", traces: "Call Traces", links: "Architecture",
  datamodel: "Data Model", health: "Health", blast: "Blast Radius", complexity: "Complexity",
  insights: "Insights", dependencies: "Dependencies", dataflows: "Data Flows",
};

/** A readable default name for a deep link: `Call Traces — orders.js`, `Health — security`. */
export function bookmarkLabel(hash: string): string {
  const [head, ...rest] = hash.split("~");
  const file = rest.length ? decodeURIComponent(rest.join("~")) : "";
  const [tab, section] = head!.split("/");
  const name = TAB_NAMES[tab!] ?? tab ?? "Report";
  const what = file ? file.split("/").pop() : section;
  return what ? `${name} — ${what}` : name;
}

/** The list with `b` added — replacing one of the same name in the same folder. */
export function withBookmark(list: readonly Bookmark[], b: Bookmark): Bookmark[] {
  return [...list.filter((x) => !(x.folder === b.folder && x.name === b.name)), b];
}

export function withoutBookmark(list: readonly Bookmark[], b: Pick<Bookmark, "folder" | "name">): Bookmark[] {
  return list.filter((x) => !(x.folder === b.folder && x.name === b.name));
}
