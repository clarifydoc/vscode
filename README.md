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
- **Your workspace stays untouched.** All output is written to the extension's
  private storage (`<globalStorage>/analyses/…`), never into your project tree.
  No `.clarifydoc/` folder appears in your repo.

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
  and *Traces*; above routes: method + path → handler. Above analyzed symbols, a
  **hover** card summarizes complexity, callers/callees, and findings.
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
| Show Output Log | Reveal the ClarifyDoc output channel |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `clarifydoc.diagnostics.enabled` | `true` | Show findings in the Problems panel |
| `clarifydoc.diagnostics.include` | all | Categories: `security`, `complexity`, `layers` |
| `clarifydoc.diagnostics.complexityThreshold` | `15` | Flag functions at/above this complexity |
| `clarifydoc.codeLens.enabled` | `true` | CodeLens above functions and routes |
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
Development Host. See `INSTALL.md` for install, update, and hot-reload details.

## License

MIT
