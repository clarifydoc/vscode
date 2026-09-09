# Change Log

## Unreleased

Deeper, native VS Code integration:

- **MCP server for AI agents**: the workspace analysis is published over the Model Context Protocol
  (VS Code 1.101+), giving chat/agent modes twelve read-only tools — routes, screens, per-file facts,
  call traces, blast radius, data model, data flows, health and git impact. Read-only by default
  (`clarifydoc.mcp.allowAnalyze` opts into agent-triggered scans; `clarifydoc.mcp.enabled` turns it off),
  plus a **Copy MCP Server Config** command for agents outside VS Code.
- **Problems panel diagnostics** for security findings, high-complexity
  functions, and layer violations (squiggles at the reported lines).
- **CodeLens** above functions (callers / callees / complexity / Traces) and
  routes (method + path → handler), plus **hover** cards over analyzed symbols.
- **Drill-down sidebar**: expand Routes / Screens / Security / Complexity
  hotspots / Sub-projects; click an item to open the source at its line.
- **Go to…** quick-pick command for routes / screens / issues / hotspots.
- **Two-way report sync**: clicking a file/symbol in the report reveals the real
  source in the editor (webview → extension `postMessage`), falling back to
  `vscode://` links outside VS Code.
- **Reach & correctness**: `extensionKind: workspace` (runs on remote/WSL/
  Codespaces hosts), workspace-trust gating, virtual-workspace declined,
  FileSystemWatcher-based auto-analysis, a Getting-Started walkthrough, default
  keybindings, and a `@vscode/test-electron` test harness.
- New settings: `clarifydoc.diagnostics.*`, `clarifydoc.codeLens.enabled`,
  `clarifydoc.hover.enabled`.

Internals: a shared analysis-data layer resolves the on-disk summary via the
bundled analyzer's `denormalizeProject` (no re-scan) and refreshes providers on
an `onAnalysisChanged` event.

## 0.1.0

Initial release.

- **Isolated, self-contained analyzer.** The ClarifyDoc CLI and all its
  tree-sitter WASM grammars are bundled inside the extension and run in an
  isolated child process — no global install, no `npx`, no repo checkout, and no
  external Node.js required (falls back to VS Code's own runtime).
- **Workspace stays clean.** All analysis output is written to the extension's
  private global storage (`<globalStorage>/analyses/…`), never into the project.
- Analyze a workspace folder with cancellable progress.
- Interactive report rendered in a webview editor tab (or the external browser).
- **Right-click a file → jump to its view** in the report (editor context menu):
  Screens & UI, Call Traces, and Blast Radius preselect the file; Architecture
  and Routes open the tab. Backed by a `#<tab>~<file>` deep-link the report
  viewer resolves to the file's screen / first symbol / blast entry.
- ClarifyDoc Activity Bar sidebar: health, headline metrics, detected frameworks.
- Status bar item showing the primary folder's health grade.
- Commands: Analyze, Full Re-scan, Open Report, Open Report in Browser,
  Detect Languages & Frameworks, Impact of Current Git Changes, Show Output.
- Optional analyze-on-save.
