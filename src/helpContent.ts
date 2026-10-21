/**
 * The Help page: what the extension gives you and why, every right-click menu
 * and every button in the report. vscode-free, so its completeness is tested
 * against package.json — a menu entry added without a line here fails a test.
 */

/** Where a help entry's "Try it" runs. `editor`: on the file last open in an
 *  editor (the help page has focus when it is clicked, so that editor is
 *  brought back first). `free`: needs nothing. Absent: shown, not runnable. */
export type RunOn = "editor" | "free";

export interface HelpEntry {
  command: string;
  /** The command's title as package.json contributes it. */
  label: string;
  does: string;
  runOn?: RunOn;
}

export interface MenuGroup {
  id: string;
  title: string;
  where: string;
  entries: HelpEntry[];
}

export const MENU_GROUPS: MenuGroup[] = [
  {
    id: "menu-editor",
    title: "In the editor",
    where: "Right-click anywhere in a source file and open the <b>ClarifyDoc</b> submenu. Each entry works on that file, or on the function under the cursor.",
    entries: [
      { command: "clarifydoc.askAgent", label: "Ask an AI Agent…", runOn: "editor", does: "Starts a ready-made agent workflow — before changing an endpoint, explain a screen's data, review your branch — filled in from where the cursor is." },
      { command: "clarifydoc.showControlFlow", label: "Show Control Flow", runOn: "editor", does: "Draws the function under the cursor as a flowchart. Click a node to jump to its line." },
      { command: "clarifydoc.jumpScreens", label: "Screens & UI for This File", runOn: "editor", does: "Opens the report on the screens this file renders, their buttons and the handlers they run." },
      { command: "clarifydoc.jumpTraces", label: "Call Traces for This File", runOn: "editor", does: "Opens the report on every call in and out of the file, followed across files, HTTP and dependency injection down to the tables." },
      { command: "clarifydoc.jumpBlast", label: "Blast Radius for This File", runOn: "editor", does: "Opens the report on every file a change here reaches, the most tightly coupled first." },
      { command: "clarifydoc.showFilesGraph", label: "Show in a Graph", runOn: "editor", does: "Draws the file's functions, the calls between them and the calls in and out, including HTTP calls across tiers." },
      { command: "clarifydoc.jumpArchitecture", label: "Show in Architecture", runOn: "editor", does: "Opens the report's dependency graph with this file selected." },
      { command: "clarifydoc.jumpRoutes", label: "Show Routes", runOn: "editor", does: "Opens the report on the routes this file serves or calls, and what is on the other end." },
      { command: "clarifydoc.openReport", label: "Open Report", runOn: "free", does: "Opens the whole interactive report." },
      { command: "clarifydoc.showHelp", label: "Help: What ClarifyDoc Does", does: "Opens this page." },
    ],
  },
  {
    id: "menu-explorer",
    title: "In the Explorer",
    where: "Right-click a file or folder in the Explorer. Select several to work on all of them.",
    entries: [
      { command: "clarifydoc.analyze", label: "Analyze Workspace", runOn: "free", does: "Maps the folder: screens, routes, calls, data. Only changed files are read again on later runs." },
      { command: "clarifydoc.ignoreFolder", label: "Ignore Folder in ClarifyDoc", does: "Adds the folder to <code>.clarifydocignore</code>, so the analyzer never enters it. Use it for generated code, clones or stored data." },
      { command: "clarifydoc.showFilesGraph", label: "Show in a Graph", runOn: "editor", does: "Graphs the selected files (a folder stands for its analyzed files) with the calls between them." },
    ],
  },
  {
    id: "menu-sidebar",
    title: "In the Analysis sidebar",
    where: "Right-click an item in the ClarifyDoc <b>Analysis</b> view. Items that name a place also show a copy icon when you hover them.",
    entries: [
      { command: "clarifydoc.copyTreeItem", label: "Copy", does: "Copies the item: a route, a file and line, a table name." },
      { command: "clarifydoc.treeItemTraces", label: "Call Traces", does: "Opens the report's Call Traces on that item." },
      { command: "clarifydoc.treeItemBlast", label: "Blast Radius", does: "Opens the report's Blast Radius on that item's file." },
      { command: "clarifydoc.deleteBookmark", label: "Delete Bookmark", does: "On a bookmark (trash icon): removes it." },
    ],
  },
];

/** The Analysis view's title bar: its icon buttons, then the "…" menu. */
export const SIDEBAR_BUTTONS: HelpEntry[] = [
  { command: "clarifydoc.analyze", label: "Analyze Workspace", runOn: "free", does: "Builds or updates the map." },
  { command: "clarifydoc.openReport", label: "Open Report", runOn: "free", does: "Opens the interactive report." },
  { command: "clarifydoc.refresh", label: "Refresh", does: "Re-reads the analysis from disk without analyzing again." },
];

export const MORE_MENU: HelpEntry[] = [
  { command: "clarifydoc.showHelp", label: "Help: What ClarifyDoc Does", does: "This page." },
  { command: "clarifydoc.goto", label: "Go to Route / Screen / Issue…", runOn: "free", does: "Fuzzy-jump to any route, screen, finding or hotspot." },
  { command: "clarifydoc.showOutput", label: "Show Output Log", runOn: "free", does: "What the analyzer did, and why when it failed." },
  { command: "clarifydoc.openReportExternal", label: "Open Report in Browser", runOn: "free", does: "The same report as a standalone page you can send to someone without VS Code." },
  { command: "clarifydoc.detectFrameworks", label: "Detect Languages & Frameworks", runOn: "free", does: "A quick look at what the analyzer recognizes, without a full run." },
  { command: "clarifydoc.impact", label: "Impact of Current Git Changes as Markdown", runOn: "free", does: "Your uncommitted diff as the screens, routes, entities and tests it affects, in a document." },
  { command: "clarifydoc.installMcpServer", label: "Set Up MCP for an AI Agent…", runOn: "free", does: "Writes the config for Claude Code, Cursor or Windsurf. Copilot's agent mode needs none." },
  { command: "clarifydoc.copyMcpConfig", label: "Copy MCP Server Config (for external agents)", runOn: "free", does: "Puts the MCP config on the clipboard for any other agent." },
  { command: "clarifydoc.openSettings", label: "Open Settings", runOn: "free", does: "CodeLens, diagnostics, analyze on save, storage." },
  { command: "clarifydoc.exportSarif", label: "Export Security Findings as SARIF", runOn: "free", does: "The security findings as SARIF 2.1.0, for code scanning tools." },
  { command: "clarifydoc.reportIssue", label: "Report an Issue", runOn: "free", does: "Opens a pre-filled issue with what the analyzer saw." },
];

// ─── The report ─────────────────────────────────────────────────────────────

export interface ReportSection {
  id: string;
  label: string;
  /** Inner SVG markup on a 24-unit grid — the report's own glyph for the section. */
  glyph: string;
  shows: string;
}

/**
 * The report's section icons, as `SECTION_GLYPH` / `SECTION_LABEL` draw them in
 * the viewer (`report/ui.tsx`). The same glyph marks a section's tab and every
 * "Open in …" button that leads to it. Copied, not imported: the viewer is
 * built separately; a test beside both sources keeps the two equal.
 */
export const REPORT_SECTIONS: ReportSection[] = [
  { id: "ui", label: "Screens & UI", glyph: `<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />`, shows: "The screens the file renders, their buttons and the handlers behind them." },
  { id: "traces", label: "Call Traces", glyph: `<circle cx="6" cy="19" r="3" /><circle cx="18" cy="5" r="3" /><path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H12" />`, shows: "Who calls what, followed across files, HTTP and dependency injection to the data." },
  { id: "links", label: "Architecture", glyph: `<rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="8.5" y="14" width="7" height="7" rx="1" /><path d="M6.5 10v2h11v-2M12 12v2" />`, shows: "The file's place in the dependency graph: services, folders, imports." },
  { id: "data-access", label: "Data Access", glyph: `<ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />`, shows: "The tables and queues the file's code reads and writes." },
  { id: "datamodel", label: "Data Model", glyph: `<rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10M15 10v10" />`, shows: "The entities it declares, with their columns and relations (ER diagram)." },
  { id: "routes", label: "Routes", glyph: `<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5" />`, shows: "The endpoints it serves or calls, and what is on the other end." },
  { id: "dataflows", label: "Data Flows", glyph: `<path d="M4 7h11M15 7l-3-3M15 7l-3 3" /><path d="M20 17H9M9 17l3-3M9 17l3 3" />`, shows: "Each route or screen traced to the tables it reads and writes." },
  { id: "health", label: "Health", glyph: `<path d="M22 12h-4l-3 9L9 3l-3 9H2" />`, shows: "Findings in the file: security, patterns, duplicates, layer violations, dead code." },
  { id: "blast", label: "Blast Radius", glyph: `<circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" />`, shows: "Everything a change to the file reaches." },
  { id: "complexity", label: "Complexity", glyph: `<path d="M3.5 17a9 9 0 1 1 17 0" /><path d="M12 14l4-4" /><circle cx="12" cy="14" r="1" />`, shows: "Its functions ranked by complexity, and a treemap of the project." },
  { id: "insights", label: "Insights", glyph: `<path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.3 1 2.1h5c.1-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z" />`, shows: "Hub files and communities: what holds the code together." },
  { id: "dependencies", label: "Dependencies", glyph: `<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5M12 13v8" />`, shows: "The external packages a manifest declares, and who uses them." },
  { id: "summary", label: "Overview", glyph: `<rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />`, shows: "The project at a glance. A tab only — never an \"Open in\" button." },
];

/** The report's other controls, by what they show. */
const REPORT_CONTROLS: Array<{ face: string; name: string; does: string }> = [
  { face: "◐ ☀ ☾", name: "Theme", does: "◐ follows VS Code's theme. Click to switch to light (☀) or dark (☾) and back." },
  { face: "Fit", name: "Fit", does: "Zooms a graph so all of it is in view. Scroll to zoom, drag to pan." },
  { face: "SVG PNG", name: "Save the graph", does: "Saves the whole graph, not only the part on screen, as an image. VS Code asks where." },
  { face: "×", name: "Close / clear", does: "Closes a detail panel, or drops the file a list is focused on, and shows everything again." },
  { face: "Diagram List", name: "Mode buttons", does: "Show the same data another way (Diagram or List, C4 or Matrix, Treemap). The highlighted one is on." },
  { face: "Show more", name: "Show more", does: "Long lists show the top rows first. Click for the rest." },
  { face: "src/app.ts:42", name: "File paths and symbols", does: "Click one to open the source at that line, beside the report." },
];

/** The report tab's own title bar in VS Code. */
export const REPORT_TITLE_BUTTONS: HelpEntry[] = [
  { command: "clarifydoc.bookmarkView", label: "Bookmark This View", does: "Saves the tab and selection you are on under Bookmarks in the Analysis view, one click from reopening it." },
  { command: "clarifydoc.showReportHelp", label: "What Do These Buttons Do?", does: "Opens this page at this section." },
];

// ─── What you get ───────────────────────────────────────────────────────────

const BENEFITS: Array<{ title: string; what: string; why: string; actions: HelpEntry[] }> = [
  {
    title: "Follow a click all the way to the database",
    what: "Screens &amp; UI and Call Traces link each button to its handler, the HTTP call it makes, the backend route that answers and the table it reads or writes — across languages, projects and dependency injection.",
    why: "Answer \"what does this button touch?\" without reading five files in three languages.",
    actions: [{ command: "clarifydoc.jumpTraces", label: "Call Traces for This File", runOn: "editor", does: "" }],
  },
  {
    title: "Know what breaks before you change it",
    what: "Blast Radius lists every file a change reaches. The <b>ClarifyDoc Impact</b> view in Source Control turns your uncommitted diff into the screens, routes, entities and tests it affects, with a risk level, and can compare the API surface with another branch.",
    why: "Review your own change the way a reviewer would, before you open the pull request.",
    actions: [{ command: "workbench.view.scm", label: "Open Source Control", runOn: "free", does: "" }],
  },
  {
    title: "Answers in the editor, where you are reading",
    what: "F12 on an API call opens the route that serves it; Shift+F12 on a route lists the calls that reach it. CodeLens shows callers, complexity and traces above each function; hovers show the route a call reaches; call hierarchies cross tiers; Ctrl+T finds routes by URL.",
    why: "Stay in the file you are reading instead of searching for strings that grep cannot connect.",
    actions: [{ command: "clarifydoc.goto", label: "Go to Route / Screen / Issue…", runOn: "free", does: "" }],
  },
  {
    title: "See the whole system",
    what: "The report shows architecture, the data model as an ER diagram, every route, data flows and dependencies. It is one self-contained <code>report.html</code>.",
    why: "Get to know a codebase you did not write in hours, and share the map with people who do not use VS Code.",
    actions: [{ command: "clarifydoc.openReport", label: "Open Report", runOn: "free", does: "" }],
  },
  {
    title: "Find what is dead, risky or tangled",
    what: "Health grades the project and lists security issues, complex functions, layer violations and dead code. The same findings appear in the Problems panel at their line, with quick fixes.",
    why: "Spend review time on what matters. Dead-code findings are tuned to leave out anything that might still be used.",
    actions: [{ command: "workbench.actions.view.problems", label: "Open Problems", runOn: "free", does: "" }],
  },
  {
    title: "Give your AI agent the real map",
    what: "The analysis is published over MCP. Copilot's agent mode picks it up with no setup; one command configures Claude Code, Cursor or Windsurf.",
    why: "The agent answers with file:line references from the real call graph instead of guessing from the files that happen to be open.",
    actions: [{ command: "clarifydoc.installMcpServer", label: "Set Up MCP for an AI Agent…", runOn: "free", does: "" }],
  },
];

const TRUST = [
  ["Deterministic", "Parsed, not guessed. No language model is involved, so the same code gives the same map."],
  ["Local", "Nothing is uploaded. No account, no telemetry."],
  ["Honest", "Every cross-file link is tagged extracted, inferred or ambiguous, so you know what to double-check."],
  ["Fast on re-runs", "Files are tracked by content hash. Only changed files are read again."],
  ["Hands off your source", "It reads your files and writes only to a self-ignoring <code>.clarifydoc/</code> folder."],
];

// ─── Rendering ──────────────────────────────────────────────────────────────

/** Every command the page can run — the panel refuses any other. */
export function runnableCommands(): Map<string, RunOn> {
  const out = new Map<string, RunOn>();
  const all = [...MENU_GROUPS.flatMap((g) => g.entries), ...SIDEBAR_BUTTONS, ...MORE_MENU, ...REPORT_TITLE_BUTTONS, ...BENEFITS.flatMap((b) => b.actions), ...QUICK_ACTIONS];
  for (const e of all) if (e.runOn) out.set(e.command, e.runOn);
  return out;
}

const QUICK_ACTIONS: HelpEntry[] = [
  { command: "clarifydoc.analyze", label: "Analyze Workspace", runOn: "free", does: "" },
  { command: "clarifydoc.openReport", label: "Open Report", runOn: "free", does: "" },
  { command: "clarifydoc.goto", label: "Go to…", runOn: "free", does: "" },
  { command: "clarifydoc.openWalkthrough", label: "Getting Started", runOn: "free", does: "" },
];

export const HELP_SECTIONS = ["benefits", "menus", "report", "keys"] as const;
export type HelpSection = (typeof HELP_SECTIONS)[number];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function runButton(e: HelpEntry, text = "Try it"): string {
  if (!e.runOn) return "";
  return `<button class="run" data-command="${esc(e.command)}" data-on="${e.runOn}" title="${esc(e.label)}">${esc(text)}</button>`;
}

function entryRows(entries: HelpEntry[]): string {
  return entries
    .map((e) => `<li><div class="row"><span class="name">${esc(e.label)}</span>${runButton(e)}</div><p>${e.does}</p></li>`)
    .join("");
}

const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const keyRows = (mac: boolean): Array<[string, string]> => {
  const mod = mac ? "⌘⌥D" : "Ctrl+Alt+D";
  return [
    [`${mod} then A`, "Analyze Workspace"],
    [`${mod} then R`, "Open Report"],
    [`${mod} then G`, "Go to Route / Screen / Issue…"],
    ["F12 on an API call", "Open the backend route that serves it"],
    ["Shift+F12 on a route", "List the calls that reach it"],
    [mac ? "⌘T" : "Ctrl+T", "Find a route by URL, a screen or an entity"],
    [mac ? "⇧⌥H" : "Shift+Alt+H", "Call hierarchy, across the HTTP boundary"],
  ];
};

/** The page's `<body>` content. Pure, for tests. */
export function renderHelpBody(opts: { mac: boolean }): string {
  const benefits = BENEFITS.map(
    (b) => `<article class="card"><h3>${b.title}</h3><p>${b.what}</p><p class="why"><b>Why it helps:</b> ${b.why}</p>${b.actions.map((a) => runButton(a, a.label)).join("")}</article>`,
  ).join("");
  const trust = TRUST.map(([t, d]) => `<li><b>${t}.</b> ${d}</li>`).join("");
  const menus = MENU_GROUPS.map(
    (g) => `<section class="menu" id="${g.id}"><h3>${g.title}</h3><p class="where">${g.where}</p><ul class="entries">${entryRows(g.entries)}</ul></section>`,
  ).join("");
  const sections = REPORT_SECTIONS.map(
    (s) => `<li><span class="glyph">${svg(s.glyph)}</span><span class="name">${esc(s.label)}</span><p>${s.shows}</p></li>`,
  ).join("");
  const controls = REPORT_CONTROLS.map((c) => `<li><span class="face">${esc(c.face)}</span><span class="name">${esc(c.name)}</span><p>${c.does}</p></li>`).join("");
  const keys = keyRows(opts.mac).map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join("");

  return `
<header>
  <h1>ClarifyDoc</h1>
  <p class="lead">Which screen calls this endpoint, and which table does it write? ClarifyDoc maps your code from the screen through the API to the database, straight from the source, and puts the answers in the editor, in an interactive report and in your AI agent.</p>
  <div class="quick">${QUICK_ACTIONS.map((a) => runButton(a, a.label)).join("")}</div>
  <nav><a href="#benefits">What you get</a><a href="#menus">Right-click menus</a><a href="#report">Report buttons</a><a href="#keys">Shortcuts</a></nav>
  <p class="target">Editor actions run on <b id="target">no file yet — open a source file</b>.</p>
</header>

<h2 id="benefits">What you get, and why it helps</h2>
<div class="cards">${benefits}</div>
<h3>Why you can rely on it</h3>
<ul class="trust">${trust}</ul>

<h2 id="menus">Right-click menus</h2>
<p>Every ClarifyDoc action is one right-click away from where you are. <b>Try it</b> runs an entry here on the file last open in the editor.</p>
${menus}
<section class="menu" id="menu-sidebar-title"><h3>The Analysis view's buttons and its <span class="more">…</span> menu</h3>
<p class="where">The icons at the top of the ClarifyDoc <b>Analysis</b> view; <b>…</b> beside them opens the rest.</p>
<ul class="entries">${entryRows(SIDEBAR_BUTTONS)}</ul>
<h4>In the … menu</h4>
<ul class="entries">${entryRows(MORE_MENU)}</ul></section>

<h2 id="report">Buttons in the report</h2>
<h3>Section icons</h3>
<p>Each section of the report has one icon, used on its tab and on every button that leads to it. Next to a file in any table or panel, a row of these icons shows the <b>other</b> sections that know that file: click one to open the same file there. Hover an icon to see its name.</p>
<ul class="glyphs">${sections}</ul>
<h3>Other controls</h3>
<ul class="controls">${controls}</ul>
<h3>On the report tab's title bar</h3>
<ul class="entries">${entryRows(REPORT_TITLE_BUTTONS)}</ul>

<h2 id="keys">Shortcuts</h2>
<table class="keys">${keys}</table>
<p class="foot">More: the <a href="#" data-command="clarifydoc.openWalkthrough" data-on="free" class="run link">Getting Started walkthrough</a> · <a href="#" data-command="clarifydoc.reportIssue" data-on="free" class="run link">report an issue</a></p>`;
}

export const HELP_CSS = `
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); line-height: 1.5; max-width: 980px; margin: 0 auto; padding: 8px 24px 48px; }
h1 { font-size: 1.8em; margin: 16px 0 4px; }
h2 { font-size: 1.35em; margin: 36px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
h3 { font-size: 1.08em; margin: 20px 0 6px; }
h4 { margin: 14px 0 4px; font-size: 1em; }
p { margin: 4px 0; }
.lead { font-size: 1.08em; max-width: 72ch; }
code, kbd { font-family: var(--vscode-editor-font-family); font-size: .92em; background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 3px; }
kbd { border: 1px solid var(--vscode-widget-border, transparent); white-space: nowrap; }
a { color: var(--vscode-textLink-foreground); }
nav { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 12px 0 4px; }
.quick { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.target { color: var(--vscode-descriptionForeground); font-size: .92em; }
button.run { font: inherit; font-size: .9em; padding: 3px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button.run:hover { background: var(--vscode-button-secondaryHoverBackground); }
.quick button.run:first-child { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
.quick button.run:first-child:hover { background: var(--vscode-button-hoverBackground); }
button.run[disabled] { opacity: .5; cursor: default; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.card { border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 6px; padding: 12px 14px; background: var(--vscode-sideBar-background, transparent); display: flex; flex-direction: column; gap: 6px; }
.card h3 { margin: 0; }
.card .why { color: var(--vscode-descriptionForeground); }
.card button.run { align-self: flex-start; margin-top: auto; }
.trust { padding-left: 20px; }
.menu { margin-top: 18px; }
.where { color: var(--vscode-descriptionForeground); }
ul.entries, ul.glyphs, ul.controls { list-style: none; padding: 0; margin: 8px 0; }
ul.entries li, ul.controls li, ul.glyphs li { padding: 6px 0; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
ul.entries .row { display: flex; align-items: center; gap: 12px; justify-content: space-between; }
.name { font-weight: 600; }
ul.glyphs li, ul.controls li { display: grid; grid-template-columns: 96px 160px 1fr; align-items: center; gap: 12px; }
ul.glyphs li { grid-template-columns: 32px 160px 1fr; }
ul.glyphs li p, ul.controls li p { margin: 0; }
.glyph svg { width: 22px; height: 22px; padding: 4px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 4px; display: block; }
.face { font-family: var(--vscode-editor-font-family); font-size: .9em; white-space: nowrap; }
.more { font-family: var(--vscode-editor-font-family); }
table.keys { border-collapse: collapse; }
table.keys td { padding: 5px 16px 5px 0; vertical-align: top; }
.foot { margin-top: 32px; color: var(--vscode-descriptionForeground); }
@media (max-width: 560px) {
  body { padding: 8px 16px 32px; }
  ul.glyphs li, ul.controls li { grid-template-columns: 40px 1fr; }
  ul.glyphs li p, ul.controls li p { grid-column: 2; }
  ul.controls li { grid-template-columns: 1fr; }
  ul.controls li p { grid-column: 1; }
}`;

/** Wires the Try-it buttons and the deep link. The first state comes from
 *  `<body data-target data-section>` — a message posted before the page has
 *  loaded can be lost; later changes come as messages. */
export const HELP_SCRIPT = `
const vscode = acquireVsCodeApi();
const target = document.getElementById("target");
let hasEditor = !!document.body.dataset.target;
if (hasEditor) target.textContent = document.body.dataset.target;
function sync() {
  for (const b of document.querySelectorAll('[data-on="editor"]')) {
    b.disabled = !hasEditor;
    b.title = hasEditor ? "" : "Open a source file first";
  }
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-command]");
  if (!el || el.disabled) return;
  e.preventDefault();
  vscode.postMessage({ type: "run", command: el.dataset.command });
});
window.addEventListener("message", (e) => {
  const m = e.data;
  if (m.type === "editor") {
    hasEditor = !!m.name;
    target.textContent = m.name || "no file yet — open a source file";
    sync();
  }
  if (m.type === "section") document.getElementById(m.section)?.scrollIntoView();
});
sync();
if (document.body.dataset.section) document.getElementById(document.body.dataset.section)?.scrollIntoView();
`;
