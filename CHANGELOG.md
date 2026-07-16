# Change Log

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
