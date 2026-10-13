# Installing, updating & developing the ClarifyDoc extension

Three ways to run this extension, depending on what you're doing:

| You want to… | Go to |
|--------------|-------|
| Use it day-to-day in your normal VS Code | [Install](#1-install-for-everyday-use) |
| Move to a newer build | [Update](#2-update) |
| Change the extension's code and see it live | [Develop with hot reload](#3-develop-with-hot-reload) |
| Let an AI agent outside VS Code read the map | [Set up MCP](#4-set-up-mcp-for-an-ai-agent) |

---

## Prerequisites

- **VS Code** 1.101 or newer.
- That's it for *using* a packaged build. The analyzer (and all its tree-sitter
  WASM grammars) is **bundled inside the extension** and runs isolated — no
  global install, no `npx`, no repo checkout. It uses `node` from your `PATH` if
  present, otherwise VS Code's own runtime, so **Node.js is not required**.
- Analysis output goes to `.clarifydoc/` in the project, which ignores itself so
  it never appears in `git status`. Set `clarifydoc.storage` to `global` to keep
  it in the extension's private storage (`<globalStorage>/analyses/…`) instead —
  which also happens automatically in untrusted or read-only workspaces.

*Building the extension from source* additionally needs **Node.js 18+** (to run
the bundler and esbuild) and a built copy of the parent ClarifyDoc repo — see
[Develop with hot reload](#3-develop-with-hot-reload).

---

## 1. Install for everyday use

### A. From a packaged `.vsix` (recommended)

A packaged build is named `clarifydoc-vscode-<version>.vsix`, with the version from
[package.json](package.json). Build one with section B if this folder has none.

**From the terminal:**

```bash
code --install-extension clarifydoc-vscode-<version>.vsix
```

**From the VS Code UI:**

1. Open the **Extensions** view (`Ctrl+Shift+X`).
2. Click the **⋯** (More Actions) menu at the top of the view.
3. Choose **Install from VSIX…** and pick the `.vsix` file.

Reload the window when prompted. You'll see a **ClarifyDoc** icon in the Activity
Bar and a **ClarifyDoc** item in the status bar.

### B. Build the `.vsix` yourself

If there's no `.vsix`, or you changed the source:

```bash
cd VsCode
npm install
npm run package          # runs the build, then writes clarifydoc-vscode-<version>.vsix
code --install-extension clarifydoc-vscode-<version>.vsix
```

---

## 2. Update

VS Code will not reinstall a package that has the **same version** already
installed. Pick one:

**Fast path — force-reinstall the same version:**

```bash
cd VsCode
npm run package
code --install-extension clarifydoc-vscode-<version>.vsix --force
```

**Clean path — bump the version, then install:**

1. Increase `"version"` in [package.json](package.json) (e.g. `0.1.11` → `0.1.12`).
2. Add a note to [CHANGELOG.md](CHANGELOG.md).
3. Repackage and install:

   ```bash
   npm run package
   code --install-extension clarifydoc-vscode-<version>.vsix
   ```

Reload the window (`Developer: Reload Window`) after installing so the new build
activates.

> To remove it: Extensions view → ClarifyDoc → **Uninstall**, or
> `code --uninstall-extension clarifydoc.clarifydoc-vscode`.

---

## 3. Develop with hot reload

This is the loop you want while editing the extension's own code.

1. Build the analyzer bundle once (needs the CLI built first — it is looked for
   at `../cli`, or wherever `CLARIFYDOC_CLI_DIR` points):

   ```bash
   # the CLI (github.com/clarifydoc/cli), checked out at ../cli
   cd ../cli
   npm install && npm run build      # produces ../cli/dist/cli.js

   # extension
   cd ../VsCode
   npm install
   npm run bundle                    # assembles clarifydoc/ from ../cli/dist + wasm grammars
   ```

   Re-run `npm run bundle` whenever the analyzer changes. (`npm run build` does
   the bundle + esbuild together.)
2. Open the **`VsCode` folder** as the workspace in VS Code.
3. Press **F5** (or Run → *Run ClarifyDoc Extension*). This:
   - starts the esbuild **watch** task in the background (`preLaunchTask`), and
   - launches a second VS Code window — the **Extension Development Host** — with
     the extension loaded. Its title bar reads `[Extension Development Host]`.
4. Open any project in that host window and try the commands / sidebar.

### The reload loop

There is no true JS hot-swap for extensions — but the round-trip is a second or
two:

1. Edit a file under `src/`.
2. **esbuild rebuilds automatically** (the watch task recompiles `out/extension.js`
   on every save; you'll see `[watch] build finished` in the Terminal panel).
3. In the **Extension Development Host** window, reload to pick up the new code:
   - press **`Ctrl+R`** (`Cmd+R` on macOS), **or**
   - Command Palette → **Developer: Reload Window**.

The debugger reattaches automatically after the reload, and breakpoints in
`src/**` keep working thanks to source maps.

> **Changed `package.json`?** Manifest changes (new commands, settings, menus,
> views) are read at load time, not by esbuild. Fully **restart** the debug
> session (stop with `Shift+F5`, then `F5` again) rather than just reloading the
> window.
>
> **Changed the analyzer?** The bundled `clarifydoc/` is *not* rebuilt by the
> watch task. Re-run `npm run bundle` (after rebuilding `../cli/dist`) and reload the
> host window.

### Manual watch (without F5)

If you'd rather run the build yourself, e.g. to package without launching a host:

```bash
npm run watch      # rebuilds on every save; Ctrl+C to stop
```

`npm run compile` does a single one-shot build, and `npm run check-types` runs
the TypeScript type-checker (esbuild strips types but does not type-check).

---

## 4. Set up MCP for an AI agent

Copilot's agent mode in this editor needs nothing — the extension publishes the
server itself (VS Code 1.101+). For an agent with its own config file:

1. Command Palette → **ClarifyDoc: Set Up MCP for an AI Agent…**
2. Pick **Claude Code**, **Cursor** or **Windsurf** (or *Copy the config* for
   anything else). The entry is merged into that agent's config; nothing else in
   the file is touched.
3. Restart the agent — MCP servers are read at startup.

What gets written is a single command, with no paths to keep in sync:

```json
{ "mcpServers": { "clarifydoc": { "command": "<globalStorage>/bin/clarifydoc-mcp" } } }
```

That launcher is regenerated on every activation, so extension updates cannot
break it, and it carries the Node runtime, so the agent needs no Node of its
own. The server serves whichever project its working directory is in and reads
that project's `.clarifydoc/`, which is why one entry — `claude mcp add
--scope user`, for instance — covers every repo you open. If the project has
never been analyzed, the server analyzes it once itself.

With `clarifydoc.storage: "global"`, the analysis is outside the project and the
written entry spells out that folder's path instead, so re-run the command after
changing that setting.

---

## Troubleshooting

- **"Could not launch the analyzer runtime"** — the analyzer normally runs on
  VS Code's own Node runtime with no setup. If you see this, set
  `clarifydoc.nodePath` to a Node.js executable (**Open Settings** in the
  ClarifyDoc sidebar overflow menu).
- **"bundled analyzer not found"** in the output log — you're running from source
  without the bundle. Run `npm run bundle`, or set `clarifydoc.cliPath` to a
  `dist/cli.js` / binary.
- **Report tab is blank** — regenerate it by running **ClarifyDoc: Analyze
  Workspace**. Check the **ClarifyDoc** output channel (*Show Output Log*) for
  analyzer errors.
- **Nothing in the sidebar** — the folder hasn't been analyzed yet; click
  **Analyze Workspace** in the welcome view.
- **Where's the output?** In `.clarifydoc/<project-name>/` inside the project
  (the ClarifyDoc output channel logs the exact path on activation). With
  `clarifydoc.storage: "global"`, or in an untrusted / read-only workspace, it is
  under `…/globalStorage/…/analyses/` instead.
- **An agent can't see the analysis** — check the ClarifyDoc output channel for
  the `[storage]` line. If it says `global`, external agents need the explicit
  path: re-run *ClarifyDoc: Set Up MCP for an AI Agent…*, which writes it for
  them. Also restart the agent after installing: MCP servers are read at
  startup.
- **"Another ClarifyDoc analysis is writing …"** — a CLI run, this extension and
  an agent all share one analysis directory now, and only one may write it. Wait
  for the other run; if it crashed, delete the `.analysis-lock.json` the message
  names.
