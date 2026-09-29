# Change Log

## 0.1.4

- **Routes keep their attribute layer, in every framework.** A route now carries who may call it (`auth`: policies,
  roles, schemes, or an anonymous marker), which API versions it serves and which are deprecated, and every
  parameter with where it binds from (body, query, route, header, form, or a framework-injected object) — declared
  bindings as such, framework defaults marked `inferred`. The Routes tab shows them as chips; `clarifydoc_routes`
  prints them. Covered: ASP.NET (C# and VB), Spring, JAX-RS, Micronaut, Ktor, NestJS, Express/Koa/Fastify,
  FastAPI, Flask, Django REST decorators, Laravel, Symfony, CodeIgniter, Go (gin, echo, chi, net/http, gorilla),
  Rust (axum, actix, Rocket), Vapor, shelf, Play (its `conf/routes` file is now analysed), Rails, Sinatra, Catalyst,
  Mojolicious, Dancer, Phoenix, Compojure and reitit, plus the contract formats — OpenAPI (parameters, security,
  requestBody, deprecated), GraphQL (arguments, directives), WSDL (message parts), JSight — and Blazor
  `@attribute [Authorize]`, Spring Web Flow `<secured>` and Delphi RAD Server `[ResourceSuffix]` endpoints.
  A route whose handler lives in another file (Express, Laravel, Rails, Go, Vapor, Phoenix…) gets its parameters
  from that handler's signature and from what its body reads (`req.body.name`, `c.ShouldBindJSON(&input)`,
  `params.require(:user).permit(...)`). Decorators in the per-file JSON keep their arguments everywhere.
- **One route per service and version.** The project route map keyed routes on method + path across the whole
  repository, so a monorepo hosting the same endpoint in two services kept one and attributed the other service's
  route to it, and a V2 and a V3 controller for one path collapsed into whichever had more calls. Identity is now
  sub-project + method + path + version set. `clarifydoc_routes` takes a `project` filter.
- **Version-aware SPA → API links.** A client calling `/api/v5/…` is linked to the controller that declares serving
  version 5, not the first twin at that path. A version no route declares is flagged `version-mismatch` instead of
  silently landing on the wrong controller.
- **Request schema per endpoint.** A route with a body parameter now carries an OpenAPI-shaped `requestSchema`:
  the parameter's class flattened through its base classes, property names as serialized, types mapped to JSON
  with nullability, `required` and enums. Mappings exist for C#, VB, Java, Kotlin, TypeScript, Python (Pydantic
  and dataclasses), PHP (typed DTOs and Laravel FormRequest rules), Go (struct tags), Rust (serde), Swift, Dart,
  Scala case classes, Perl Moose, Elixir Ecto schemas, Clojure Malli/Schema, and the OpenAPI/GraphQL/WSDL/JSight
  type definitions. Where only body fields are known (`req.body.email`, `validate([...])`), the schema is built from
  them. `clarifydoc_routes` returns it with `schema: true`; the Routes tab shows it on the body chip.
- **MCP answers questions about the attribute layer.** `clarifydoc_routes` filters by `policy`, `role`, `scheme`,
  `anonymous`, `version`, `deprecated` and `bodyType`; `clarifydoc_search` matches policies, roles, schemes and
  versions; the file, screens and trace tools mark each route they mention with its guard and versions and each
  frontend call with a `version-mismatch` when the called version is not served. New `clarifydoc_contract` returns
  one endpoint as an OpenAPI-shaped operation — security, parameters with their location, request body schema — for
  an agent that intends to call it.
- **LSP enhancement works from the extension.** The bundled analyzer never shipped the Docker build contexts, so
  every language server failed to build and the run silently continued without LSP. They are bundled now, a
  missing context is named outright, and when LSP is enabled but skipped the extension says so.

## 0.1.3

- **Show Control Flow.** The `$(flame) complexity 47` CodeLens used to open the Complexity tab, which told you again
  that the function was bad. It now draws the function: a control-flow graph rendered as a Mermaid flowchart in a
  side panel, with the shape of the problem spelled out above it ("6 decisions · 3 loops · 11 exit points"). The
  graph is built on demand by a new `clarifydoc cfg` command that reads one file and writes nothing, so it works on
  a file the analyzer has never seen and the analysis artifact does not grow.
  - Click a node to jump to its source; move the cursor in the editor and the node it sits in is highlighted.
  - A statement that hides branches in its expressions — ternaries, `&&`/`||`, a callback the graph does not descend
    into — carries a `(+n)` badge, because that is complexity you cannot see by reading the shape.
  - **Every language the analyzer parses to an AST**: TypeScript/JavaScript (including Vue and Svelte single-file
    components), C#, Python, PHP, Java, Kotlin and Pascal/Delphi. The rest are extracted by regex and have no syntax
    tree to read, so their flame lens keeps opening the Complexity report as before rather than leading somewhere
    that cannot help.
  - **Languages with no parser get one too.** Go, Rust, C, C++, Objective-C, Swift, Dart and Perl have no syntax tree
    here, so their control flow is read off the source text instead — comments, strings and regex literals blanked,
    nesting inferred from braces. Those graphs are labelled **Approximate** in the panel, because inferring is not
    parsing. Measured against the real parser on the languages that have both, it reads the same shape for 96% of
    TypeScript, 100% of Java and 91% of C# functions.
  - Also available from the editor context menu and as **ClarifyDoc: Show Control Flow** in the command palette.


- **Search that answers a question asked in words.** `clarifydoc_search` — the tool an agent reaches for first, and
  the one behind **Set Up MCP for an AI Agent…** — matched a query as one literal substring printed into six fixed
  sections. So `user login` found nothing at all (the whole phrase had to appear contiguously), `getUserById` was
  unreachable from `user id`, and what ranked first was whatever section printed first rather than whatever matched
  best. It now splits both the query and every candidate on camelCase and on `_ - / .`, requires every term, and
  ranks everything it found — routes, screens, symbols, entities, files — in one list, best first. Accuracy against
  the hand-labelled benchmark repos went from 0.845 to **1.000**: every labelled query now answers at rank 1.

## 0.1.2

Follow a file through the report, and a real data model for Delphi codebases:

- **Follow a file into every section.** Every nav tab now carries a glyph, and the same glyph marks that section
  wherever a link leads there. The scattered text links that jumped between tabs (`Screen ↗`, `Blast radius ↗`,
  `View … in call traces →`) are replaced by one strip of icon buttons per file — one button for each section that
  knows the file, the current section left out — on detail panels and table rows alike (rows reveal it on hover).
  Each section opens *on* the file: Architecture drills into the file's component with its node selected and
  centred, Data Access selects its caller node (a Delphi form resolves to its paired unit), Data Model selects the
  first entity it declares, Routes, Data Flows, Complexity and Insights highlight and scroll to its rows (Data Flows
  and Dependencies also narrow to it, with a chip to clear), and Health opens the first section holding a finding
  for it.

- **Delphi tables, columns and relationships** in the Data Model tab (and over MCP). A Delphi/Firebird project
  keeps no schema in the repo — no DDL, no migrations, no ORM classes — so this view used to show, at best, a
  scatter of bare table names read out of raw SQL. The analyzer now reconstructs the schema from what the IDE
  persists in every `.dfm`: a dataset's single-table `UpdateSQL`/`InsertSQL`/`DeleteSQL` names the table and
  enumerates its columns, its persistent `TField` children give each column's type and width, and join
  predicates give the foreign keys. On a 200-form codebase that is ~70 tables with ~580 typed columns and ~60
  relationships where there were none.
- Columns are taken from a dataset's single-table DML rather than its field list, because a `SelectSQL` is
  usually a join — so a column borrowed from a joined table is no longer attributed to the table being edited.
  Firebird **selectable stored procedures** (`FROM SP_WAITLIST(:ID)`) are no longer mistaken for tables.
- **Fixed:** tables that are only ever seen in a query (no schema anywhere) rendered with a lowercased name and
  an unopenable `inferred:123` location. They now carry the real name and a `path:line` into the file that
  queries them.
- **`.clarifydoc/ignore` — exclude code from the map.** Gitignore syntax (negation, comments, anchored and
  unanchored patterns), kept with the analysis rather than as another dotfile at the project root, with patterns
  relative to the directory holding `.clarifydoc/` so `/Library/*` reads the way it looks. The existing root-level
  `.clarifydocignore` keeps working; the new file is read second in each directory and wins on an equal match.

  The exclusion reaches everything, not just file discovery: **framework detection** and **sub-project detection**
  honour it too, so an ignored directory cannot report frameworks the project never uses or spawn scanned roots of
  its own. `.clarifydoc/` now also counts as a project-root marker when walking up for ignore files — without it a
  tree with no VCS directory (a Delphi checkout exported from source control) silently failed to inherit the root's
  ignore file into its sub-project scans. On a ~3,800-file Delphi repo, ignoring the vendored `Library/`: 678 files
  analyzed, sub-projects 81 → 4, and the framework list went from 11 (including FireMonkey, Lazarus and Qt, none of
  which the project uses) to the 6 it actually has.
- **The main form is identified.** A Delphi `.dpr` states it outright and in order — the FIRST
  `Application.CreateForm` is the window the app opens on launch, later ones are created at startup but shown on
  demand — so Screens & UI now badges them **main** and **startup**, and the main form counts as a page whatever
  its form class is called. Since the form class is an *argument*, not part of the call chain, the call table could
  not carry it; the project file's source is kept for this, the way route files already are. The screen graph is
  rooted as a result: on one codebase `Main.dfm` opens 46 screens directly and reaches 85 of 221 transitively, and
  a project with several `.dpr`s gets a main form per application.
- **Screen-to-screen navigation for Delphi.** The Screens tab's *opens* / *opened by* links were derived only from
  JavaScript dynamic imports, so a VCL app — which navigates by constructing a form class rather than importing it —
  showed no relationships at all. The `.dfm` is an authoritative registry for this: its root object names both the
  form class and the global instance, so `TfrmRelationer.Create` and `frmWait.Show` each identify a specific screen
  file with no guessing (and the far more numerous `TpFIBQuery.Create` / `TFileStream.Create` are excluded because
  they are not forms). Dialog-opener helpers that build the form declared by their own unit (`ShowPupilsWindow`,
  `ShowTeams`) are credited to their CALLERS, resolved through the symbol-link table so a launcher named `Execute`
  attributes only where the linker actually resolved it.
- **Fixed: half of a Delphi project's database accesses were recorded against invented tables.** `Query.FieldByName`
  / `dsPlayers.Open` is `component.method`, but the engine read it as the `Model.findOne` shape and named the
  RECEIVER as the table — inventing `DataSet` (1,766 hits on one codebase), `Query`, `ADataSet`, `Qry`. Worse, that
  bogus name *blocked* the real link, since the form's component→table map is only consulted while the entity is
  still unset. Delphi dataset/connection API calls no longer claim an entity, so the physical table gets attached
  instead: phantom ER nodes fell from ~292 to 0 and attribution to real tables went UP.
- **Fixed: table-valued functions were recorded as tables.** Firebird selectable stored procedures
  (`FROM SP_WAITLIST(:ID, :MATCH_DATE)`) — and Postgres set-returning functions like `generate_series` — are callable
  routines, not stored relations. 146 of them had become tables; now 3.
- **Delphi third-party stacks are detected.** Framework detection sampled only the first 10 `.pas` files of a
  project (arbitrary on a 3,000-unit codebase) and matched unit names case-sensitively, even though Pascal is
  case-insensitive. It also only knew scoped unit names (`Vcl.Forms`), so every pre-XE2 codebase — most Delphi
  still in service — showed no VCL at all. Now a wider sample, case-insensitive matching, classic unit names, and
  rules for FIBPlus, IBX, FireDAC, DevExpress VCL, JVCL and Indy.
- **Fixed:** two `.dfm` parsing bugs that silently corrupted the data model. `UpdateSQL` was never read (only
  IBX's `ModifySQL` was), hiding both the UPDATE and the table's column list on every FIBPlus dataset; and a
  long SQL line split across source lines with `+` was rejoined with a space, splitting identifiers
  (`GARAGE1.POST` + `CODE`). Vendor field classes (`TFIBStringField`, `TIBBCDField`, `TFDDateTimeField`) are now
  typed like their plain `TField` counterparts.

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

## 0.1.1

Making the MCP server easy to use for agents outside this editor:

- **The analysis now lives in the project**, at `.clarifydoc/<name>/` — the same place `clarifydoc analyze` and
  `clarifydoc mcp` use by default. An external agent therefore needs no path at all, one config entry works in every
  repo, and a CLI run shares one copy (and one incremental cache) with the extension. The directory ignores itself
  (a `.gitignore` containing `*`), so nothing appears in `git status` and your own ignore file is untouched. Set
  `clarifydoc.storage` to `global` for the previous behaviour; that also happens automatically when the workspace is
  untrusted or read-only.
- **Set Up MCP for an AI Agent…** — a new command that writes the config for Claude Code (`claude mcp add`), Cursor
  or Windsurf, merging into whatever is already there, instead of leaving you to paste a snippet. Offered once,
  unprompted, in a workspace that already configures MCP agents.
- **Configs that survive updates.** Agent configs now point at `<globalStorage>/bin/clarifydoc-mcp`, a launcher
  rewritten on every activation, rather than at the version-stamped extension directory — which used to break
  silently on every extension update. It also carries the Node runtime, so the agent needs none of its own.
- **No more dead ends before the first analysis.** A read-only MCP server now analyzes a project that has never been
  analyzed, once, on demand; an advisory lock in the analysis directory keeps that from colliding with a run started
  here or from the CLI.
- Auto-analysis ignores changes under `.clarifydoc/`, so writing the report cannot re-trigger it.
- **Fixed:** the analyzer failed with `unknown command '…/cli.js'` when run on VS Code's own runtime — the fallback
  used on machines with no Node.js installed. Commander was sniffing `process.versions.electron` and parsing argv
  Electron-style; the CLI now states `from: "node"`.

## 0.1.0

Initial release.

- **Isolated, self-contained analyzer.** The ClarifyDoc CLI and all its
  tree-sitter WASM grammars are bundled inside the extension and run in an
  isolated child process — no global install, no `npx`, no repo checkout, and no
  external Node.js required (falls back to VS Code's own runtime).
- **Workspace stays clean.** All analysis output is written to the extension's
  private global storage (`<globalStorage>/analyses/…`), never into the project.
  (Changed in 0.1.1: the analysis lives in a self-ignoring `.clarifydoc/` in the
  project by default; `clarifydoc.storage: "global"` restores this behaviour.)
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
