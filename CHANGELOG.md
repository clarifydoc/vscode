# Change Log

## 0.1.17

The bundled analyzer is now 0.9.0 (extractor 1.583.0), so each project is analyzed again once after the
update, when you pause. Call traces, impact, the sidebar and the MCP tools all read what it now finds:

- **Eleven more languages read by a parser.** Go, Lua, Rust, C and C++ (C++20 and C++23 included) are read by
  their grammars, and Swift, Dart, Elixir, Scala, Objective-C and Haskell by tree-sitter, instead of by line
  patterns. Functions end where they end, calls inside closures, chains, generic calls and macros are found,
  and a declaration is no longer taken for a call. Call traces gain the links that follow: on real projects up
  to a few thousand more. A file the grammar cannot read keeps the earlier reading, so nothing is lost.
- **Imports by what they name.** Go module paths, Dart packages, Swift modules, Scala packages, C# namespaces
  and Ruby's autoloaded constants resolve to their files; a constant another module declares is followed to its
  value; a Rust trait method implemented in another crate is reached.
- **Where a route parameter comes from, and what it filters.** Call traces show which screen value feeds each
  route parameter, and which column the backend filters on with it (Python, C#, Java, Kotlin, Go, Ruby, PHP,
  Laravel route-model binding).
- **Follows more requests:** URL helpers and request factories in JavaScript, Java, C# and Go, Python HTTP
  sessions and test clients, websockets (Django Channels, `new WebSocket`), JAX-WS ports, Java's
  `openConnection`, YARP `MapForwarder` forwarding.
- **Reaches more tables:** Django `RunSQL` and Alembic `op.execute`, Django related managers, SQLAlchemy
  statements, xorm and Diesel queries, PHP's `mysqli_*`/`pg_*` functions, FluentMigrator, JPQL entities — and
  stops reporting tables that are none: caches, request bags, event hooks, message ports.
- **Links more of the screen to its handlers:** Vue emits however the parent spells them, Angular outputs,
  React handlers assigned in a constructor, Alpine.js directives, Nuxt auto-imports, Flutter screens through
  their State.
- **Guards a route inherits** from where its router or controller is declared are shown on the route; a
  FastAPI dependency counts as a guard only when it checks the caller.
- **For agents:** search ranks functions and classes by their doc comments and, asked in words, by what their
  bodies say; the analysis can be exported as a spec per screen with the user flows through it.

## 0.1.16

- **Impact lists the docs to update.** The Source Control Impact view has a *Docs to update* group: each
  Markdown line that names a changed file — its path, a route it serves or a class it declares — with what it
  says, opening at that line. The count is the total even when the list is capped.
- **Every signature change is worded.** In Impact, a function moved to another file reads "moved to
  `src/garage.ts`", a changed parameter type "takes `id: Uuid`, was `id: string`", and a function no longer
  exported or public says so. They used to read "undefined → undefined required parameters". A kind a newer
  analyzer reports that this extension does not know is named as it is.
- **Tables reached from commands, jobs and tools.** The sidebar's Data group counts the entry points that are
  not routes or screens — CLI and editor commands, MCP tools, scheduled jobs, message consumers — beside them
  ("written by 1 entry point · read by 3 routes"), lists them with their own icon, and opens one at its handler.
  A table only such an entry point wrote used to read "written by" with nothing after it.
- **Before writing new code.** *Ask an AI Agent…* offers the analyzer's new *Before writing new code*
  workflow: whether what you are about to write already exists in the project, and the installed API of a
  package you will call. The selected text fills in what the code will do (comment markers dropped), and an
  import line under the cursor names the package.
- **More for Claude Code.** *Set Up MCP for an AI Agent…* → Claude Code → **Hooks** now also runs before a new
  file is written: when the map already holds something under a similar name, Claude sees it before writing a
  second one. The after-edit hook leads with the decision records that name the file. **Skills** include
  *before writing*. Run the setup again to add them; it writes only what changed.
- **New for agents.** The MCP server the extension publishes adds `clarifydoc_context_docs` (the project's
  decision records, architecture and glossary documents and schema dumps, each flagged when files it names
  changed after it), and `clarifydoc_extract package=…` gives an installed package's API at the version
  installed. Answers about a file edited since the analysis say so. `clarifydoc_explain` says what a file or function is — route
  handler, data access, publisher, screen, API client — and which other routes share its tables.
- The control-flow panel says once, in its banner, that a graph read from source text is approximate.

The bundled analyzer is now 0.8.0 (extractor 1.462.0), so each project is analyzed again once after the
update, when you pause. It now:

- **Finds more routes:** Azure Functions (C#, JavaScript/TypeScript, Python and `function.json`), Fastify,
  hapi and Koa route objects and prefixed plugins, a plain Node `http.createServer` that dispatches by hand,
  gorilla/mux route builders, Laravel routes registered in a loop, Django model views registered per model and
  DRF routers that map extra verbs, Phoenix `forward`.
- **Follows more calls to their service:** Spring Cloud Gateway and Zuul routes as forwarding rules, Spring
  context paths, Feign clients by service name, WebClient, RestClient and HTTP interfaces, Apache HttpClient,
  Refit interfaces, CXF endpoint addresses, and the resources a .NET Aspire AppHost adds as addresses.
- **Reaches more tables:** a stored procedure called by name joined to the SQL routine that declares it
  (T-SQL batches and bodies read), JPA `persist(new Match(…))`, a DAO whose implementation's SQL names its
  table, generic repositories typed along the call chain, Ecto `Repo.preload`, receivers typed through type
  aliases, `package.json` `#imports`, Dart constructors and Python factories.
- **Sees more screens and events:** Angular `routerLink` and `navigate` as navigation, the pages of a Vite or
  webpack sub-project, in-process event buses in Go and chained JavaScript emitters, Spring messaging templates
  by declared type.
- **Records more:** doc comments on functions and classes, data flows ranked by criticality, a seam sketch
  for an oversized file, duplicates compared by shape rather than by call names, Gradle version catalogs, and
  Markdown as a dependent of the files it names.
- **Gives the same output for the same input** on every run, and an incremental run notices a changed
  `tsconfig.json` or `package.json` alias.

## 0.1.15

- **The analysis loads on a worker thread.** Reading a large project's analysis no longer holds up other
  extensions. On a 115 MB summary, the longest pause in the extension host drops from about 220 ms to about
  65 ms, and the extension host keeps about 90 MB of it in memory instead of about 660 MB. If the worker
  cannot run, the analysis is read in the extension host as before.
- **An editor language-server pass that answers nothing merges nothing.** It used to write an empty result,
  and every view then read the whole analysis again and the open report was regenerated.
- **Analysis runs below normal priority**, so the editor stays responsive while it runs. It still gets all
  the CPU nothing else needs.
- **Impact marks the callers your change broke.** A caller in the Source Control Impact view that the editor
  reports an error at, on the line of the call, gets an error icon and "error at the call"; one whose file has
  errors elsewhere says how many. The group counts them ("4 · 2 with errors"), and the marks follow the
  editor's Problems as you fix them, without rerunning the analyzer. ClarifyDoc's own findings do not count.
- **Copilot gets its own instructions file.** In a project that instructs Copilot
  (`.github/copilot-instructions.md` or `.github/instructions/`) and has no `AGENTS.md` or `CLAUDE.md`,
  *Tell AI Agents When to Use ClarifyDoc* writes `.github/instructions/clarifydoc.instructions.md` with
  `applyTo: "**"`, and leaves the shared `copilot-instructions.md` alone. A section an earlier version put
  there is still updated in place.
- **After an update, re-analysis waits until you pause.** A new analyzer makes every analysis out of date. The
  status bar now says "analyzer updated", and the re-analysis starts once nothing has been typed for 30
  seconds, instead of a fixed 30 seconds after the window opens. A save, or a click on the status bar, starts
  it sooner. Files changed while the window was closed are caught up on as soon as the existing analysis is
  shown, instead of after 5 seconds.
- **Startup timings in the output.** The ClarifyDoc output channel logs when Problems, the sidebar and the
  status bar first show the analysis, the extension host's longest pause in the first 10 seconds, and how
  many analysis changes were announced. Include these lines when you report a slow start.

## 0.1.14

- **Help page.** *Help: What ClarifyDoc Does*, first in the Analysis view's **…** menu and last in the editor's
  ClarifyDoc submenu, says what each part of the extension gives you and why it helps, lists every right-click menu
  entry (in the editor, the Explorer and the sidebar) with a **Try it** button that runs it on the file you had
  open, and explains the report's buttons: each section icon, the "Open in …" icon rows beside files, Fit, the
  graph export, the theme switch. **?** on the report's title bar opens it at that part.
- **Faster start.** A window that opens on an existing analysis reads it once and rebuilds the sidebar,
  Problems and decorations once. Before, they were all rebuilt a second time soon after start. Questions that
  only change with the analyzer (which file types it reads, which languages have a control-flow graph) are
  remembered per analyzer build, so a window starts no analyzer process until an analysis runs. After an
  update, the catch-up re-analysis waits 30 s instead of starting with the window. Problems are published in
  one batch, and the Impact view follows git only once it is shown. The output channel logs `[startup]`
  timings.
- **Real progress while analyzing.** The notification names the stage the analysis is in and how many files are
  done, and its bar fills as the run goes: files up to 80%, then each later stage.
- **Impact: where each caller stands.** Each caller of a changed function is marked as updated in this change,
  covered by the test that calls it, or unverified — the unverified ones carry a warning icon, as the callers to
  read. A removed function that was probably renamed names its new name, and a changed return type reads
  "returns X, was Y".
- **Fixed:** git commands the extension runs no longer start a `core.fsmonitor` program the repository configures.

## 0.1.13

- **Neighbourhood.** A graph of the open file, docked in the ClarifyDoc sidebar: its functions, the calls
  between them, the calls in and out, the routes it serves and the HTTP calls it makes. It redraws when
  another file comes forward or the analysis changes, and outlines the function under the cursor as it moves.
  *Functions* and *Files* switch the level, and a node opens its source.
- **Taint paths in Problems.** A security finding that carries its taint path lists each step as a related
  location, request input first, before the routes that reach it. Findings imported from another tool's SARIF
  show their flows the same way, across files.
- **Response fields no route sends.** A call that reads a field from the response that its route does not
  send is an Information note at the call, with the route as the related location, beside the request
  contract findings.

- **Doc drift in Problems.** Paths, routes and class members your Markdown names that the code no longer has
  show on the doc's line. A path git saw renamed or deleted is a warning, and a rename has a quick fix that
  writes the new name. One with no history behind it is a note: it may be a plan. Category `docDrift` in
  `clarifydoc.diagnostics.include`, on by default.

- **Lines no test runs.** When the analysis reads a coverage report (`coverage/lcov.info`, `coverage.xml`,
  JaCoCo, Clover or Go, found at the usual paths), the editor marks the lines no test runs: a faint background
  and a mark in the overview ruler. Hovering one says how much of the file is run, which report it came from,
  and whether that report is older than the code. `clarifydoc.coverage.overlay` and *ClarifyDoc: Toggle
  Coverage Overlay* turn it off.

- **Notes on the map, readable by agents.** The report's Notes, on a file in Architecture or an entity in Data
  Model, now work in the editor. Previously only the ClarifyDoc server kept them. Notes are tied to the file or
  entity, not a line, so they survive re-analysis. They live beside the analysis as `notes.json`, and as
  `notes.md` with each subject's routes, the screens that reach them and the tables they write. *Tell AI Agents
  When to Use ClarifyDoc* now points the AGENTS.md section at `notes.md` and lists the newest notes. That
  section is still written only after you confirm the diff.
- **Bookmarked views.** *Bookmark This View* (the report's title bar, or the palette) names the place the report
  is at: a tab, a Health section, a file focused in a tab. The sidebar lists bookmarks under **Bookmarks**, and
  one click opens the report there again.

- **Risky files marked in the Explorer.** A file the analysis rates high (`!`) or critical (`!!`) risk to change
  gets a badge and a tint in the Explorer and on its editor tab. Hovering shows the verdict and its reasons,
  the same verdict as the risk CodeLens, before you open the file. `clarifydoc.decorations.risk` turns it
  off.

- **Save the report's graphs.** SVG and PNG on a report graph (Architecture, Data Model, Call Traces…) now go
  through the editor's save dialog. A webview ignores a browser download, and PNG export was blocked outright
  by the report's own content policy, which allows images only from `data:` URLs.
- **Open in Mermaid Live.** The diagram and control-flow panels have an *Open in Mermaid Live* button. It
  opens mermaid.live in your browser with the diagram in the link's fragment. It runs only when you click it
  and is never written into a saved file.

- **The report moves in place.** A jump into an open report (a CodeLens, *Jump to…*, a quick fix) is a message
  to the viewer that is already up, rather than a new page that inflates the whole payload again. On the
  largest stored scan that takes a jump from 0.36–0.48 s to 0.04–0.08 s. A new analysis reloads the open
  report the same way and keeps your place. A report built by an older analyzer falls back to replacing
  the page.
- **The report follows the editor** (`clarifydoc.report.followEditor`, off by default). While the report shows
  Call Traces, Screens or Blast Radius, switching editors moves it to the new file. A file the analysis never
  read leaves it where it is.

- **Show in a Graph.** Select files or folders in the Explorer (or use the editor's ClarifyDoc menu) and
  *Show in a Graph* draws them: each file as a group of its functions and the routes it declares, the calls
  between them, and the calls into and out of the selection, folded onto the files at the other end. HTTP
  calls that cross a tier go to the route that serves them, named by method and path. *Functions* and
  *Files* switch the level, a node opens its source on click, and Save / Copy take the view on screen. A
  selected folder stands for the analyzed files under it, up to 40.
- **Fix: a report deep link survives a first analysis.** Opening the report at a place (a CodeLens, a jump)
  in a folder with no analysis offered to analyze it, then forgot where you were going. It now opens there.

- **Analyze on save, on by default where it is cheap.** `clarifydoc.analyzeOnSave` is now `auto` | `on` |
  `off`, and defaults to `auto`. Auto turns the save loop on for a folder whose last real analysis took 5 s or
  less (an "up to date" exit is not counted) and re-judges it after every run. A quick folder is analyzed a
  second after a save rather than 2.5 s. The old `true` / `false` still mean `on` / `off`. Measured save →
  refreshed analysis: 1.2–1.3 s on the React, FastAPI and ASP.NET fixtures (auto: on). On Chatwoot, 7.6–7.7 s
  with `on`; auto leaves it off, since its runs take 5.5–8.4 s.
- **Fix: the save watcher saw no change at all.** It watched one glob with nested braces
  (`{**/*.{ts,…},**/{Jenkinsfile,…}}`), and VS Code's file watcher delivers no event for that shape. That has
  been the case since the analyzer started listing extension-less file names. It now watches one flat glob
  per part.

- **Report an Issue.** *ClarifyDoc: Report an Issue* (palette, and the sidebar's ⋯ menu) asks whether it is a
  bug, a gap in the analysis or an idea. It then opens a GitHub issue prefilled with what a maintainer asks
  first: the extension and analyzer versions, editor, OS, remote and the settings that change behaviour.
  For each folder it adds the file counts by extension, frameworks, routes, screens and calls found, calls
  that reached no route, and thin spots. It names no file, folder or route. Nothing is sent until you submit
  it on GitHub, and *Copy Text* is there instead. *Report a Gap* after a thin analysis now opens the same
  issue.

- **A live control-flow panel.** The panel follows the cursor: moving into another function in the folder
  draws that one, and editing the function drawn redraws it from the unsaved text. Neither takes focus from
  the editor, and a cursor between functions keeps the last diagram. Which lines are functions comes from the
  analysis when it has the file, so resting the cursor costs nothing. *Follow the cursor and redraw on edit*
  in the panel's header turns this off.

- **Frontend and backend in different workspace folders.** Each folder is analyzed alone, so a call in `web`
  never reaches a route in `api`. After both are analyzed, the extension runs the engine's route linker
  across them. When one folder's unplaced calls are served by the other's routes, it says how many, logs
  examples, and offers to reopen on the folders' common parent and analyze it as one map. It never offers
  the filesystem root or the home directory, and *Don't Ask Again* is remembered per folder set.

- **More agents set up from the editor.** *Set up AI agents* now also writes the MCP server into Gemini CLI
  (`.gemini/settings.json`), Codex (`~/.codex/config.toml`) and Claude Desktop, and reads an existing
  `.github/copilot-instructions.md` as a guidance file. For Claude Code it offers the hooks (the map in each
  session's context, a search answered from it, the map refreshed after an edit) and the skills, written by the
  bundled CLI through a `clarifydoc` launcher in the extension's storage — no global install needed.

- **Risk at the top of a file.** A file the analysis rates high or critical risk to change gets a lens on its
  first line — *high risk to change* — with why on hover: what it is (an edge of the system, a shared
  contract…), what behaviour depends on it, and the rules that fired. `clarifydoc.codeLens.risk` turns it off.

- **A route as a sequence diagram.** Each API route gets a *sequence* CodeLens: what the route does, in
  order — its handler, the calls it makes, the tables it reads and writes, the HTTP calls into another tier —
  drawn by the engine's `clarifydoc seq` in the diagram panel, which saves it as Mermaid, Markdown or SVG.
  *ClarifyDoc: Show a Route as a Sequence Diagram* picks a route from the palette.

- **Other tools' findings in Problems.** A finding the analysis imported from another tool's SARIF
  (`clarifydoc analyze --import-sarif`) says whose it is — *ClarifyDoc · Semgrep*, the tool's rule id in the
  message — beside the CWE link and the routes that reach it.

- **The map is thin here.** A file the analysis read only in part — syntax the parser could not follow — or
  whose relative imports resolve to no file gets an Information note in Problems, and while it is open the
  status bar says *thin map*: a missing caller, route or link there may be a blind spot, not a fact. A new
  `thinMap` category of `clarifydoc.diagnostics.include`, on by default.

- **What your branch changes in the API.** With the Impact view comparing against a branch, *Compare API
  Surface* (the view's title bar, or the row it adds) analyzes the base once — in a temporary git worktree,
  seeded from this analysis so only the files that differ reparse — and lists what the branch changes in the
  API surface: a route removed or moved, a parameter that binds elsewhere, a request body that now requires a
  field, a guard added or lost, an API version dropped, a call that no longer reaches any route. Breaking
  changes first, a lost guard marked risky; each row opens its file. The base's analysis is kept per commit,
  so later refreshes only re-diff. `clarifydoc.impactCompareWith` now also takes a ref as its argument.

- **What the last save reached.** After an automatic analysis the status bar says what the change reaches
  ("the last change reaches 2 routes"), the report's Overview shows the latest change's impact, and the
  Routes tab marks the routes whose file changed (`~ changed`) and those the change reaches (`→ reached`) —
  told apart by colour, glyph and border, not colour alone.
- **What your change breaks, function by function.** When the diff's lines are known, the Impact view leads
  with *Signature changes* (a function removed or given a new required parameter, and whether that breaks
  the callers as written), then *Will break* — the direct callers, routes named by their route — *Likely
  affected* (2–4 hops, with the weakest link's confidence) and *Review* (files that import the change but
  call nothing in it). Each changed file lists the functions the change touched. **Copy Impact for Agent**
  (the view's title bar) puts the same verdict on the clipboard as Markdown, against the compared base.
- **Who to ask.** The Impact view gains *Usually changed with* — files that history says move with one you
  changed, which this change leaves alone — and *Reviewers*: the CODEOWNERS owners of the changed files and
  the people who made most of their commits. A function's hover card names the file's owners and main
  authors, and says so when one person made most of its changes. Both need the analysis's git history
  (`clarifydoc.gitHistory`, on by default).
- **Layer 2 without Docker.** After each analysis, the language servers this editor already runs are
  asked where the calls ClarifyDoc could not resolve lead — within a budget (2000 questions, two
  minutes), with ClarifyDoc's own providers quiet meanwhile so it never answers itself — and the
  unambiguous answers become call links in the report, CodeLens and call hierarchy. Only servers you have
  installed answer; one naming two places is left out unless exactly one of them is a declaration the
  analysis knows. *ClarifyDoc: Resolve Calls with the Editor's Language Servers* runs it by hand;
  `clarifydoc.editorLsp.enabled` turns it off. It stands aside while `clarifydoc.enableLsp` (Docker) is on.
- **API gaps in the sidebar.** A new *API gaps* group lists the API calls that reach no route — with why:
  no route serves the path, a route serves it for another method, the service it goes to has no such
  route — and the routes no call in the repository reaches. A renamed endpoint shows up as the client
  call still asking for the old path.
- **Data in the sidebar.** A new *Data* group lists every table the analysis saw accessed, with the routes
  and screens that write and read it (`orders — written by 2 routes · read by 3 routes, 1 screen`).
  Clicking a table opens its entity; clicking a route or screen opens it.
- **Right-click a sidebar item** to copy it (`GET /api/orders`, a table name) or open its file's Call
  Traces or Blast Radius in the report. Security findings are grouped by severity, worst first.
- **Callers that are tests.** The caller CodeLens counts the tests among them (`3 callers · 1 test`), by
  the analyzer's own per-language test rules. A function over the complexity threshold that no test
  calls says `no test caller` — where the project has tests at all.
- **"Complete" says what it missed.** When a server framework the project depends on left no route on the
  map, or a frontend framework no screen, the message after an analysis names it (`express is a
  dependency, yet no API route was found`) instead of a plain "complete", with *Report a Gap*, which
  opens a prefilled issue in the browser — nothing is sent from the editor.
- **Save a control-flow diagram** as SVG or as Mermaid (`.mmd`, or a fenced block in `.md`) through the
  editor's save dialog.
- **Report:** one search box across the report (`/`), an architecture edge lists the file pairs behind
  it, a churn × complexity chart, a *Knowledge risk* section (files only one person has changed, ranked by
  the routes and entities they carry), and large graphs open legible instead of fitted to specks.
- The MCP setup picker no longer offers the project's `.mcp.json` as "shared with your team": the entry
  holds this machine's install path, so it is marked as this machine's only.

- **The status bar says when the analysis is out of date.** It counts the files changed or removed
  since the last analysis (`ClarifyDoc: B · 3 changed`), or says the analyzer was updated, and clicking
  it re-analyzes. The check reruns when the window regains focus. With analyze-on-save on, a folder
  whose analysis went stale while VS Code was closed is re-analyzed at startup.
- **Compare the impact with a branch.** *Compare Impact With…* in the ClarifyDoc Impact view diffs
  against a branch, tag or commit instead of HEAD — from the point your branch forked, as a pull
  request shows it. The view's caption names the base, and each folder remembers its own.
- **Report links open the editor you use.** A report opened in the browser from Cursor, Windsurf,
  VSCodium or VS Code Insiders opens files back in that editor, not in VS Code.

## 0.1.12

Bundles analyzer 0.7.0, which now exports its MCP index, agent guidance, workflows and SARIF writer, and draws
control flow from text given on stdin.

- **From a screen's API call to the route, and back.** Go to Definition on an API call's URL opens the
  backend route that serves it, in whichever language and project it lives. Find References on a route
  lists the calls that reach it. A route's CodeLens says who calls it, from which screens, and what it
  reads and writes (`1 caller · 2 screens · writes Order`). Hovering a call names its route, or why it
  reaches none; hovering a route shows its callers, screens and the path to its data. Links the analyzer
  marked ambiguous are described, never jumped to. Turn it off with `clarifydoc.crossTier.enabled`.
- **Call hierarchy across tiers.** Show Call Hierarchy on a controller action lists the frontend
  functions that call its route, and climbs on to the components that call those. Each entry says how
  sure the link is and how it was made. A language's own call hierarchy (TypeScript, a C# or Java
  server) still takes precedence where one exists.
- **Security findings name their CWE and the routes that reach them.** The Problems panel links the
  CWE, and lists the API routes whose handlers reach the finding. Quick fixes: show those routes, or
  suppress the finding with `clarifydoc-ignore-next-line`. A complex function's quick fix opens its
  control flow, a layer violation's opens the architecture view, and any finding's folder can be left
  out of the analysis.
- **Find routes, screens and entities with Go to Symbol in Workspace.** Ctrl+T finds an API route by its
  URL (`get orders`), a screen by name or route, and a data entity by name.
- **What your changes reach, in Source Control.** A *ClarifyDoc Impact* view beside your changes lists the
  API routes and screens above the changed files, the data below them and the tests to run, with a risk
  level and its reasons. It refreshes as git state changes, and its badge counts the affected routes.
- **Type hierarchy in any language the analyzer reads.** Show Type Hierarchy lists a type's supertypes
  and subtypes among the project's own types — an interface's implementations, a base controller's
  subclasses — where no language extension provides a hierarchy.
- **Dead code as faded text, when you ask for it.** Add `deadCode` to `clarifydoc.diagnostics.include` and
  unused exports and unreachable files fade in the editor, each saying what the analyzer judged. The
  sidebar lists them under *Dead code*, with any project it did not judge and why. Off by default:
  every finding is an accusation.
- **Export security findings as SARIF.** *Export Security Findings as SARIF* writes the latest analysis's
  findings as SARIF 2.1.0 (what GitHub code scanning reads) without analyzing again, and opens it in the
  SARIF Viewer when that is installed.
- **Control flow of what is on screen.** Show Control Flow draws the editor's unsaved text, not the saved
  file.
- **The status bar follows your editor.** In a multi-root workspace it speaks for the active file's
  folder, and its tooltip, like the first line of the log, names the extension and analyzer versions.
- **A better first run.** The walkthrough opens once after install, with screenshots of each step. A
  workspace never analyzed gets one quiet offer to analyze it. The MCP set-up offer now looks at every
  folder, not only the first.
- **The report stays where you were.** A report tab comes back after a window reload, at the tab and file
  you had open, and a re-analysis refreshes it in place instead of returning to the first tab.
- **Tell your agents when to use ClarifyDoc.** *Tell AI Agents When to Use ClarifyDoc* adds a short section
  to AGENTS.md (or CLAUDE.md, or a Cursor rule) saying which tool answers which question and why text
  search cannot. It shows the change as a diff first and keeps the section between markers, so running
  it again updates it. It is also offered after setting up MCP.
- **Ask an AI agent from the editor.** *Ask an AI Agent…* (right-click → ClarifyDoc) offers the MCP
  server's workflows — before editing a file, before changing an endpoint, explain a screen's data,
  trace a feature, review your branch — filled in from where your cursor is, and opens them in the chat.
- **One index with the MCP server.** The editor groups the analysis by file with the MCP server's own
  index, so the two always agree.

- **Layer violations reach the Problems panel.** The extension read field names the analyzer never wrote,
  so no layer-violation diagnostic ever appeared. Each one now names the import and the layers it crosses,
  plus the team rule it breaks when there is one.
- **The same analysis as the report and MCP.** The summary is read the way the report and the MCP server
  read it, including a current LSP enhancement. A summary that cannot be read is logged with its reason,
  and retried, instead of silently leaving the views empty.
- **Findings stay on their line while you edit.** Diagnostics, CodeLens and the hover card follow the code
  they were computed for until the next analysis, instead of staying at a line number that now names
  different code.
- **Analyze on save, quieter and complete.** It watches every file type the analyzer reads, not a fixed
  list of 24. A change made during a run starts one more run instead of being dropped. Automatic runs show
  progress in the status bar, refresh an open report and never open one.
- **Safer report and hover.** The report runs under a Content Security Policy and loads nothing from disk.
  It can only open files inside the workspace folder. Text from the analyzed code is escaped in hover
  cards, and their links can run only ClarifyDoc's own commands.
- **No blocking at startup.** Finding Node and the `claude` CLI no longer blocks the extension host.
  Closing the window stops a running analysis. Report generation, framework detection and impact can be
  cancelled.
- **Leveled log.** The ClarifyDoc output is a log channel with levels, so warnings and errors stand out
  and the level can be set.

## 0.1.11

Bundles analyzer 0.7.0, which now skips folders in `.clarifydocignore` without walking them.

- **Ignore a folder from the Explorer.** Right-click a folder → *Ignore Folder in ClarifyDoc* adds it to the
  workspace's `.clarifydocignore`. The analyzer no longer walks an ignored folder at all, so a tree of clones,
  stored data or generated files stops slowing every run.
- **No more stalls after an analysis of a large project.** The tree, status bar, diagnostics and CodeLens shared
  one read of the summary in name only; each parsed it again, all at once. They now share a single read per
  analysis, and the analyzer's output reaches the output channel in batches.
- **Analyze from any menu.** A command invoked with an argument that is not a folder no longer fails with
  "Cannot read properties of undefined (reading 'fsPath')"; it falls back to the workspace folder.

## 0.1.10

Bundles analyzer 0.7.0.

- **Server-rendered screens.** Rails `.erb` views, Phoenix templates and LiveViews, Handlebars, Liquid, Velocity
  and Razor templates are screens now. Their forms, buttons and links join the route they request, so a click traces
  into the controller and on to the database. JSP forms and `.do`/`.action` links join their actions the same way.
- **Readable C4 component diagrams.** A dense project is boxed by top folder, and a large folder is split into
  role groups — controllers / API, services, events / jobs, data access, data models, utils, infrastructure — with
  the datastores outside. Arrows run between groups, the strongest drawn at rest; hover a group or a module for its
  own links.
- **More traces reach the database.** Laravel route-model binding and parent-declared members; Rails
  `before_action` filters, concerns and memoized models; xorm and GORM session chains; Ecto writes; JPA and
  Hibernate `persist`/`find`/`merge`; SQL `INSERT`/`UPDATE`/`DELETE` naming their table; EF Core through a context
  member; a Delphi dataset passed to a routine followed back to its table. A generic `create`/`update` call in
  JavaScript is data access only when the file has an ORM or driver to show for it.
- **New routes and frontend links.** ASP.NET Minimal APIs (`MapGet`, `MapGroup`, versions and authorization), Go
  Huma operations, Rails routes anchored on their controller actions, OpenAPI and WSDL operations joined to the class
  implementing the generated interface, generated TypeScript SDK clients (hey-api, openapi-fetch) and base-client
  URLs per subclass.
- **Event and store hops.** Vuex `dispatch('ns/action')`, React callback props drilled to the parent's handler,
  Redux `mapDispatchToProps`, Flutter inline `onPressed` closures, Riverpod notifiers, Blazor `@code` methods and
  MAUI command bindings.
- **Control-flow graphs for Ruby, Lua, Elixir and VB**, plus cognitive complexity and nesting depth for the
  regex-analyzed languages.
- **Fewer dead-code accusations.** Histoire stories, nuxt i18n locale files and C# 14 extension blocks are
  recognised as reached.

## 0.1.9

Bundles analyzer 0.6.0.

- **Traces reach the database where they stopped short.** Measured on 34 real codebases, the screen → API →
  database trace now continues through: Laravel's Eloquent models and relation chains, Rails `before_action`
  loaders and association chains, Phoenix controllers, Spring WebFlux functional endpoints
  (`route().GET(…)`), C# repositories over a generic base (`IRepository<Movie>`), Python repositories over a
  generic base reached through typed properties, Go routes handled by closures, Rust workspace crates imported by
  package name, Kysely tables, Pascal form tables, and Java `EntityManager` calls naming their class. A Laravel API
  went from 0 to two thirds of its routes reaching a table; a Rails one from 5% to 36%.
- **Flutter screens and buttons.** Pages (`Scaffold`, `@RoutePage`, `*Page`), `onPressed`/`onTap` handlers and
  navigation targets are extracted, and Drift / Isar / Floor / Hive models are entities with their relations — a
  Flutter app's local database joins the Data Model and the traces.
- **Vue Options API and Svelte 5.** `methods`, `computed` and lifecycle hooks of an Options API component are
  functions, so `@click="save"` resolves; Svelte 5 `onclick={…}` attributes are events. Angular external templates
  no longer appear twice.
- **Data models.** Ecto schemas with their associations, Go struct associations across files (xorm and GORM),
  Marr table mappings. An entity named by a dotted module (`Plausible.Site`) matches the code that calls it `Site`.
- **Complexity for every language.** Functions in regex-analyzed languages (Go, Rust, Ruby, Dart, Elixir, …)
  now have a cyclomatic complexity, marked approximate; the CodeLens and the Complexity report show them.
- **Fewer dead-code accusations.** FluentMigrator migrations, BenchmarkDotNet projects, components registered by
  `unplugin-vue-components`, and pages of a vite file-based router (`VueRouter({ routesFolder })`,
  `vite-plugin-pages`) are recognised as reached.

## 0.1.8

Bundles analyzer 0.5.0.

- **Calls reach the right service when several serve the same path.** A call used to be linked to a route by
  its path alone, so when two services both served `/api/items` the link was a guess. Each call now gets an
  origin: the service it actually reaches. The analyzer finds it from what the code and its configuration state,
  such as an absolute URL, the HTTP client the call goes through (.NET typed and named clients,
  `axios.create({ baseURL })`) or the env or config value its base reads (`process.env.ORDERS_URL`,
  `_config["Services:Inventory"]`). It reads those values from docker-compose and Kubernetes env and from config
  files such as `appsettings.json` and `launchSettings.json`, then matches the host to a project by service name
  or port. When the origin is known, the call links only to a route that service serves, never to another
  service's route.
- **Through dev proxies and gateways.** A frontend's same-origin `fetch("/api/orders")` is followed through its
  dev server's proxy (Vite, webpack, Vue CLI, `setupProxy.js`, Angular `proxy.conf.json`, CRA `proxy`). A request
  that reaches a gateway (YARP, Ocelot) is followed through the gateway's route, with path rewrites, for up to
  four hops.
- **Java REST client proxies.** Some calls go to an interface that Spring XML or a client factory (CXF, Jersey,
  RESTEasy, MicroProfile, Feign) turns into a REST client. These now link to the JAX-RS route that declares the
  same operation. No URL is needed, because the shared API interface states the operation.
- **Which service calls which.**
  - A link that crosses sub-projects names the calling project and the serving one.
  - In the Architecture tab, the containers view draws the HTTP and message edges between projects, with their
    endpoints on hover. At the Deployment level, ✓ marks a docker-compose or Kubernetes edge only when calls were
    found along it.
  - In the Routes tab, outbound calls show the route the linker chose, and the serving project when it's another
    one.
  - Agents get the edges from the new `clarifydoc_services` tool.
- **Many more calls resolved.** Call Traces and the caller and callee lenses now follow:
  - chained calls through declared return types (`a.getB().getC().m()`, `Factory::getInstance()->m()`)
  - locals typed by the call that initializes them (`var u = await repo.FindAsync(id)`)
  - `super` calls and methods from mixins and traits
  - re-exports through barrels and `__init__.py`
  - bare calls to a sibling file in the same Go, Kotlin or Swift package
  - Elixir aliases, Pascal `uses` and PHP `@return` docblocks

  Across 33 real codebases, resolved calls rose 10% (512,866 to 564,003). On two codebases checked against a
  language server, the share of its answers the linker now matches rose from 27% to 66% and from 2% to 25%, with
  no new conflicts.
- **Delphi forms.** Calls through a form variable (`form: TfrmMain`) and through `TfrmMain.Create(Self)` now reach
  the form's methods and constructor. Before, the form's `.dfm` made its class name ambiguous. HeidiSQL gains 405
  links. The main form also stays marked as the app's startup screen after an incremental re-analysis, and agents
  can ask `clarifydoc_screens` for just the startup forms.
- **Tabs keep their state.** Switching tabs in the report no longer resets the tab you left: its selection,
  search, filters, expanded rows, scroll position and graph zoom stay as they were.
- **"Open in report" lands on the file in every tab.** Before, only three tabs opened at the file. Now *Open the
  Complexity report for this file* in the control-flow view opens Complexity at that file instead of the whole
  list, and the route CodeLens opens the Routes tab at its file.

## 0.1.7

Bundles analyzer 0.4.0.

- **Frontend calls reach their backend on real apps.** Many real frontends build their URLs in ways the
  analyzer couldn't follow, so it linked almost none of their calls. It now follows the URL to the route that
  serves it when a service builds it on a base field (`this.baseUrl + 'series/' + id`, with the base set from an
  environment file), through a URL helper (also one inherited from a base service), through a request factory
  (`createFetchHandler('system.status', '/system/status')`), or through a generated OpenAPI client. A
  `fetch(url, { method: "POST" })` call now carries its verb. On a hand-labelled sample of 73 frontend calls in
  Kavita, mealie and paperless-ngx, 71 now reach the route that serves them and none link to a wrong one. In
  0.1.6, none of the 73 linked.
- **Routes that frameworks assemble across files.** These routes were missing or had the wrong path:
  - ASP.NET controllers inheriting `[Route("api/[controller]")]` and actions from a base controller, and a
    project's own routing attributes (Radarr's `[V3ApiController]`).
  - Django urlconfs and DRF routers (paperless-ngx went from 0 API routes to 189).
  - FastAPI/Flask routers whose prefix is set where they're included.
- **More careful links.**
  - A call is never linked to a route that only serves another HTTP method.
  - When an endpoint exists both as code and in an OpenAPI spec, the call links to the controller that
    implements it, not to the spec entry.
  - A `/v2` call doesn't land on a `/v1` route.
  - Only real HTTP calls count as API calls, so `request.params.get('page')` no longer does.
- **About 30 more languages and dialects.** Groovy, PowerShell, Bash, Windows batch, F#, CoffeeScript, R,
  Julia, Crystal, Zig, OCaml, Raku, Racket, Scheme, Common Lisp, Nim, D, V, Fortran, Haxe, Mojo, SCSS/Sass/Less,
  AutoHotkey, AutoIt and AppleScript, plus C# scripts, VBScript, CUDA, Scala scripts and Perl tests/PSGI/CGI.
  Each gets CodeLens, hovers and Call Traces like every other analyzed language.
- **Fairer health grades on large codebases.** 19 of 22 well-maintained open-source repositories used to grade
  F, because penalties were raw counts that any big codebase maxed out. Each dimension is now a rate per file,
  calibrated on real repositories: the median is 78 and none grade F. Tests no longer count against any
  dimension.
- **Go, Rust and Ruby imports point at one package.** An import used to connect to every directory with the
  same last name. Gitea's dependency graph went from 302k edges to 104k, and dead-code results got more
  accurate as a side effect.
- **Report fixes.**
  - A diagram the layout engine can't route no longer blanks the whole report. Instead, that view says why it
    failed and the other tabs keep working.
  - Following a file or event handler into Call Traces now filters the list to that file.

## 0.1.6

Bundles analyzer 0.3.0.

- **Dead code, in every language.** The Health tab gains a *Dead code* section: authored files that no entry
  point reaches, and, for JS/TS, exports that no other file imports. Each language reaches code its own way:
  JS/TS and Python follow imports from their real entry points (package.json scripts, console scripts,
  `__main__`, server commands), Rust follows the `mod` tree, and in C#, Java, PHP, Ruby, Go, C and the rest a
  file is reached when reachable code names something it declares. Some code is kept alive and never reported:
  whatever a framework discovers (controllers, handlers, plugins), files run by a tool (configs, migrations,
  scripts), tests, and a published library's public API. The check favors precision over recall: every
  finding on the real repositories it was measured on was traced by hand. Agents get the findings from
  `clarifydoc_health category="dead-code"` and the counts from `clarifydoc_status`.
- **Calls through dependency injection reach the implementation.** A call like `this.repo.save()` on an
  injected `IOrderRepository` used to stop at the interface, or not link at all. It now resolves on the
  receiver's declared type, then through the container registration to the class actually built. Covered
  containers include MS DI, Autofac, Spring, Guice, Dagger, NestJS/Angular providers, Inversify, Laravel,
  Symfony, FastAPI `Depends`, wire/fx, Swinject and get_it. When the registrations don't single out one
  implementation, the call stays on the interface instead of guessing. Call traces and the caller/callee lenses
  follow these links. Blast radius now also counts implements/extends edges that no import states.
- **HTTP clients with a base URL** (`axios.create({ baseURL })`, ky, got) now prefix their calls' URLs, so a
  frontend call links to the right backend route instead of an unrelated one that happens to share its path.
- **Lenses and hovers in every language.** Ruby, Go, Rust, C/C++, Swift, Dart, VB, Scala, Elixir, Perl and the
  other regex-extracted languages had no CodeLens or hover at all. They now get callers, callees and *Traces*,
  but no complexity lens, because complexity needs a syntax tree. On the fixtures, function lenses went from
  0 to 88 for Ruby, 0 to 46 for Go and 0 to 65 for Perl.
- **Classes get a references lens** and hover card, counting `extends X`, type positions and `new X`. It opens
  the caller picker.
- **Lens counts match the list they open.** The caller lens counted raw links while its picker listed call
  sites, so Java's `AuthService.authenticate` read "2 callers" but listed one. The lens, hover and picker now
  read one index, and the hover's "1 callers" now reads "1 caller".

## 0.1.5

Bundles analyzer 0.2.0 (`clarifydoc --version`; the MCP server's `serverInfo` and every artifact's provenance
now name the analyzer release itself, not the extension's).

- **Which screen touches which table.** Data Flows used to start only at API routes; screens are entries now, and
  each reaches through its own code, its child components and the HTTP calls into the backend. On the RealWorld
  React + Express app a profile page now reaches the `User` and `Article` tables three hops away. The tab gains
  a SCREEN badge, an entry filter and "Screens reaching a write"; `clarifydoc_data_flows` with
  `entryKind: "screen"` — which had always answered "no data flows" — answers.
- **Express backends with inline handlers are crossed.** `router.get("/x", auth, async (req, res) => …)` has no
  named function at the route, so no frontend call was ever linked into such a backend: RealWorld had 0
  frontend → backend trace links, now 22.
- **A browser component no longer "writes the database".** A call recognised as ORM access by its method name
  (`agent.Comments.create(…)`) but resolving into the project's own code — an API client, a service, an
  in-memory store — is not database access; the function it calls is. ORM model and interface methods (an
  ActiveRecord scope, a Spring Data finder) still count.
- **API clients written as objects are symbols.** `const Profile = { get: (u) => … }`, default-exported objects
  and `module.exports = {…}`: their members are functions now, so `agent.Profile.get(…)` links and its API call
  belongs to a function. On a rule engine built from `export const visitor = { visit() {…} }` objects this added
  1,834 call links.
- **Every page reached by a JSX route has its route.** `<Route component={Profile}>`, `element={<Page />}`
  (unwrapping `<RequireAuth>`/`<Suspense>`), `lazy(() => import(…))`, `render=` and v5 children — on RealWorld 8
  of 8 pages, was 1. A `pages/` folder in a React Router or Vue app no longer invents a route per file; only
  Next.js and Nuxt route by file.
- **Python relative imports link.** `from .graph import x` was read as a file named `.graph`, so none of those
  calls linked (0 of 276 on one package, now 241); imports inside functions, `try/except ImportError` and
  `if TYPE_CHECKING:` are read too.
- **Fewer false calls and links.** A variable or parameter passed as an argument (`save(user)`) is no longer a
  "call" — a quarter of all calls on three real repositories were these, and some linked to unrelated
  functions. Calls into the file's own code (`this.exec()`, an injected `this.users.findOne()`) are no longer
  read as database calls by name, which had kept them from linking; NestJS controllers now link to their
  services.
- **Symlinks stay inside the project.** Analysis no longer follows a link out of the workspace, and a
  self-referencing link no longer repeats the tree dozens of levels deep; refused links are listed in the
  summary. `site-packages/` and `bower_components/` are skipped like `node_modules/`.
- **Requires VS Code 1.101 or newer** (was 1.85) — the release that finalized the MCP provider API the extension
  publishes its analysis through.

## 0.1.4

- **SPA → API links through service-class URL builders.** A frontend whose every request goes through a method on
  a config singleton (`configService.APIUrl("logout.json")`) had no links at all: the URL template was only captured
  for free functions, only from a top-level `return`, and the resolver did not recognise a `receiver.method(...)`
  call. Class methods now carry templates; `if`/`else` branches and both arms of a returned ternary are followed,
  a literal origin or a runtime config base (`store.state.config.API_URL`) is dropped rather than left as a `{}`
  segment, and a helper that returns a different path per branch (`/api/staff/…` for employees, `/api/…` for
  admins) gives the call one URL per branch — the link follows the first branch that reaches a route
  (`targetAlternatives` on the api-call). On a Rails + Quasar repository this took the joined calls from 5 of 166 to 159.
- **Rails namespaced controllers keep their namespace.** A controller declared inside `module Staff` (or named
  `Staff::DutiesController`) was emitted as `/duties` with a bare `DutiesController#index` handler, colliding
  with the top-level controller of the same name — an admin call was traced into the employee controller. The
  convention routes now carry the module's path and qualified name, `namespace :x` verb and `resources` routes name
  the `X::` class, a directory in a controller token (`admin/users#index`) becomes a module, `get 'presence', on:
  :collection` / `on: :member` hangs off the enclosing resource with that resource's controller, and a `resources`
  block nested in another is served under the parent's member (`/employees/:employee_id/contact_informations`).

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
