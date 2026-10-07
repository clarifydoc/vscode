# ClarifyDoc for VS Code

Map any codebase — **frontend route → API endpoint → database** — straight from
source, without leaving your editor. This extension runs the **ClarifyDoc**
analyzer (tree-sitter static analysis, no AI) and renders its interactive report
inside VS Code.

## Runs isolated — nothing to install, nothing to pollute

The analyzer is **bundled inside the extension** and runs in an **isolated
child process**:

- **No external analyzer.** No global install, no `npx` download, no dependency
  on a repo checkout — the CLI and all its tree-sitter WASM grammars ship in the
  VSIX.
- **No Node.js required.** It uses `node` from your `PATH` if present, otherwise
  falls back to VS Code's own runtime — so it works out of the box.
- **Your source files are never modified.** The analyzer only reads them. What it
  writes goes to one directory, `.clarifydoc/` in the project — see below.

## Where the analysis lives

`<project>/.clarifydoc/<name>/` holds `project-summary.json`, `report.html` and
the per-file JSON. That location is deliberate: it is exactly where
`clarifydoc analyze` writes and where `clarifydoc mcp` looks, so **any AI agent
opened on your project finds the map with no configuration**, and a CLI run
shares one copy — and one incremental cache — with this extension.

It stays out of your way:

- **Invisible to git.** The analyzer drops a `.gitignore` containing `*` inside
  that directory, so it ignores itself. Nothing shows up in `git status`, and
  your own `.gitignore` is never touched. (Want to commit the map so teammates
  and CI agents get it without scanning? Empty that file — it is only written
  when absent.)
- **Invisible to search.** VS Code's search and Quick Open honour ignore files,
  so the report never turns up in results.
- **Never analyzed.** `.clarifydoc/` is excluded from discovery, so a scan
  cannot eat its own output.

## Excluding code from the map

Put a `.clarifydoc/ignore` file next to the analysis and list what to leave out,
in ordinary **gitignore syntax** — patterns relative to the project root,
`!` to re-include, `#` for comments:

```gitignore
# Vendored third-party source: Delphi has no package manager, so component
# libraries live in the tree — their demos and tests are not this project.
/Library/mORMot-master/*

# …but keep our own patched fork.
!/Library/mORMot-master/OurFork/**
```

Ignored files are not analyzed at all: they contribute no symbols, screens,
data sources or tables, and the directory is also skipped by framework and
sub-project detection — so vendored code stops diluting the report, the health
score and the MCP answers.

A `.clarifydocignore` at the project root works too; both files are inherited
from parent directories, and `.clarifydoc/ignore` is read second in each
directory so it has the final say.

Prefer the project tree completely untouched? Set `clarifydoc.storage` to
`global` and everything goes to the extension's private storage
(`<globalStorage>/analyses/…`) instead. That also happens automatically when the
workspace is untrusted or read-only, so analysis still works there.

## Features

- **Analyze Workspace** — runs the analyzer on a workspace folder with a
  cancellable progress notification, streaming output to the "ClarifyDoc" output
  channel.
- **Interactive report in the editor** — the self-contained HTML report
  (Overview, Screens, Call Traces, Architecture, Data Model, Routes,
  Dependencies, Health, Blast Radius, Patterns, Security, Complexity,
  Suggestions, Insights) renders in a webview tab, or opens in your browser.
- **Right-click a file → jump to its view.** From the editor context menu, the
  **ClarifyDoc** submenu opens the report deep-linked to the current file:
  *Screens & UI*, *Call Traces*, and *Blast Radius* preselect that file; *Show in
  Architecture* and *Show Routes* open the corresponding tab.
- **Problems panel** — security findings, high-complexity functions, and layer
  violations appear as diagnostics with squiggles at their exact lines.
- **CodeLens** — above functions: callers / callees (click to jump), complexity,
  and *Traces*; above classes: references; above routes: method + path → handler.
  Above analyzed symbols, a **hover** card summarizes complexity, callers/callees,
  and findings. Works in every analyzed language; complexity needs a syntax tree,
  so regex-extracted languages (Ruby, Go, Rust, …) show no complexity lens.
- **Drill-down sidebar** — expand Routes / Screens / Security / Complexity
  hotspots / Sub-projects and click any item to open the source at its line.
- **Go to… quick-pick** (`ClarifyDoc: Go to…`) — fuzzy-jump to any route, screen,
  security issue, or hotspot.
- **Two-way report sync** — clicking a file/symbol in the report reveals the real
  source in the editor beside it (no OS prompt).
- **Remote & trust aware** — runs on the remote/WSL/Codespaces host, requires a
  trusted workspace, and declines virtual workspaces.
- **ClarifyDoc sidebar** — an Activity Bar view showing the last analysis at a
  glance: health grade, headline metrics (files, routes, links, traces, screens,
  entities, security issues…) and detected frameworks. Loads from storage, so it
  survives restarts with no re-scan.
- **Status bar** — the health grade of the primary folder; click to open the
  report.
- **Detect Languages & Frameworks** — a fast detection-only pass.
- **Impact of Current Git Changes** — projects your working-tree changes onto the
  last analysis and shows the affected screens / routes / entities / tests as a
  markdown preview.
- **Analyze on save** *(opt-in)* — incrementally re-analyze a few seconds after
  you save.

## Your AI agent can read the map too (MCP)

The extension publishes the workspace analysis as a **Model Context Protocol** server, so Copilot's agent mode can ask
ClarifyDoc for routes, call traces, blast radius, the data model and the impact of the current diff — grounded in
parsed code, with `path:line` references — instead of inferring it from a few open files.

- **Zero configuration in this editor.** One server per workspace folder, pointed at the analysis this extension
  already produced.
- **One command for other agents.** Run **ClarifyDoc: Set Up MCP for an AI Agent…** and pick Claude Code, Cursor or
  Windsurf — it writes that agent's config for you, merging into whatever is already there. (**Copy MCP Server
  Config** still puts the snippet on your clipboard for anything else.)
- **Configs that keep working.** They point at a launcher in the extension's storage whose path never changes, not at
  the version-stamped extension directory — so an extension update cannot silently break your agent. It also carries
  the Node runtime, so the agent needs no Node install of its own.
- **Nothing to point at a path.** Because the analysis lives in the project, the entry is just a command:

  ```json
  { "mcpServers": { "clarifydoc": { "command": "<globalStorage>/bin/clarifydoc-mcp" } } }
  ```

  The server serves whichever project its working directory sits in, walking up to the project root — so one
  user-level entry covers every repo you open.
- **Read-only by default, but never a dead end.** Agents read the latest analysis and cannot re-scan unless you turn
  on `clarifydoc.mcp.allowAnalyze`. A project with *no* analysis at all is analyzed once, on demand, so an agent is
  useful immediately; a directory lock keeps that run from colliding with one started here or from the CLI. Turn the
  whole thing off with `clarifydoc.mcp.enabled`.

Tools: `clarifydoc_status`, `clarifydoc_search`, `clarifydoc_routes`, `clarifydoc_screens`,
`clarifydoc_file`, `clarifydoc_trace`, `clarifydoc_blast_radius`, `clarifydoc_data_model`,
`clarifydoc_data_flows`, `clarifydoc_health`, `clarifydoc_impact`, `clarifydoc_analyze`.

## Commands

All under the **ClarifyDoc** category in the Command Palette:

| Command | What it does |
|---------|--------------|
| Analyze Workspace | Analyze a folder (incremental by default) |
| Analyze Workspace (Full Re-scan) | Ignore the incremental cache |
| Open Report | Show the interactive report (editor or browser) |
| Open Report in Browser | Force the external browser |
| Screens & UI / Call Traces / Blast Radius for This File | Right-click jump, file preselected |
| Show in Architecture / Show Routes | Right-click jump to that tab |
| Go to… | Quick-pick a route / screen / issue / hotspot and jump to it |
| Detect Languages & Frameworks | Quick detection only |
| Impact of Current Git Changes | Diff → affected screens/routes/entities |
| Set Up MCP for an AI Agent… | Write the MCP config for Claude Code / Cursor / Windsurf |
| Copy MCP Server Config | Put the MCP config on the clipboard for any other agent |
| Show Output Log | Reveal the ClarifyDoc output channel |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `clarifydoc.storage` | `workspace` | `workspace` (`.clarifydoc/` in the project, self-ignoring) or `global` (extension storage) |
| `clarifydoc.diagnostics.enabled` | `true` | Show findings in the Problems panel |
| `clarifydoc.diagnostics.include` | all | Categories: `security`, `complexity`, `layers` |
| `clarifydoc.diagnostics.complexityThreshold` | `15` | Flag functions at/above this complexity |
| `clarifydoc.codeLens.enabled` | `true` | CodeLens above functions, classes and routes |
| `clarifydoc.hover.enabled` | `true` | ClarifyDoc hover cards |
| `clarifydoc.incremental` | `true` | Reuse cache for unchanged files |
| `clarifydoc.enableLsp` | `false` | Layer-2 LSP enhancement (needs Docker) |
| `clarifydoc.lspTimeout` | `0` | LSP startup timeout (ms; 0 = analyzer default) |
| `clarifydoc.gitHistory` | `true` | Collect git churn / hotspots |
| `clarifydoc.maxFiles` | `0` | Cap files analyzed (0 = unlimited) |
| `clarifydoc.includeGlobs` | `[]` | Extra include globs |
| `clarifydoc.excludeGlobs` | `[]` | Extra exclude globs |
| `clarifydoc.openReportAfterAnalyze` | `true` | Auto-open the report after analysis |
| `clarifydoc.reportLocation` | `editor` | `editor` (webview) or `browser` |
| `clarifydoc.analyzeOnSave` | `false` | Re-analyze shortly after each save |
| `clarifydoc.mcp.enabled` | `true` | Publish the analysis to AI agents over MCP |
| `clarifydoc.mcp.allowAnalyze` | `false` | Let an agent trigger a re-analysis |
| `clarifydoc.nodePath` | *(auto)* | Node.js executable to run the analyzer |
| `clarifydoc.cliPath` | *(bundled)* | Advanced: override the bundled analyzer |

## Development

The analyzer is bundled from the parent ClarifyDoc repo, so build the repo
first, then bundle + compile the extension:

```bash
# repo root — produces ../dist/cli.js
npm install && npm run build

# extension
cd VsCode
npm install
npm run build     # runs scripts/bundle-cli.mjs (assembles clarifydoc/) then esbuild
```

Then press **F5** ("Run ClarifyDoc Extension") to launch an Extension
Development Host. See [INSTALL.md](INSTALL.md) for install, update, and hot-reload details.

## Support

- Website: [clarifydoc.com](https://clarifydoc.com)
- Issues and source: [github.com/clarifydoc/vscode](https://github.com/clarifydoc/vscode/issues)
- Email: [support@clarifydoc.com](mailto:support@clarifydoc.com)

## License

MIT
