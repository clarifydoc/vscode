// Assemble a self-contained copy of the ClarifyDoc analyzer inside the
// extension so it can run ISOLATED — no sibling repo checkout, no global
// install, no workspace pollution. Produces:
//
//   VsCode/clarifydoc/
//     package.json            { "type": "module" }  (so Node loads dist as ESM)
//     dist/                   the built CLI (cli.js, index.js, analyze-worker.js,
//                             chunks, html-report/viewer-assets/report-template.html)
//     node_modules/           the analyzer's production dependency closure, but:
//                               • WASM grammar packages → package.json + *.wasm only
//                                 (their build/, src/, prebuilds & .node are dead weight
//                                  because the analyzer loads grammars as WASM, not native)
//                               • native-only grammars we never load & native build
//                                 helpers → skipped entirely
//                               • pure-JS deps (commander, fast-glob & closure,
//                                 web-tree-sitter) → copied whole
//
// Run via `npm run bundle` (also invoked by `npm run build`). Requires the CLI
// (github.com/clarifydoc/cli) to have been built first (`npm run build` in it →
// dist/cli.js). It is looked for at ../cli — where the monorepo checks it out —
// or wherever CLARIFYDOC_CLI_DIR points.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extRoot = resolve(here, "..");
const repoRoot = resolve(process.env.CLARIFYDOC_CLI_DIR ?? join(extRoot, "..", "cli"));
const distSrc = join(repoRoot, "dist");
const dest = join(extRoot, "clarifydoc");
const rootVersion = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;

/**
 * Grammar packages loaded as WASM — only their package.json + *.wasm are read.
 * Matched by name, not listed: a hand-kept list missed the OCaml, F#, Julia,
 * Bash, Zig and R grammars, which then shipped whole (C sources, native
 * prebuilds — a 45 MB VSIX instead of 5). A grammar with no .wasm fails the
 * bundle below; one the analyzer never loads belongs in SKIP.
 */
const isWasmGrammar = (name) => /(^|\/)tree-sitter-/.test(name);

/**
 * Production deps that exist only to support NATIVE tree-sitter bindings the
 * analyzer never loads (it uses web-tree-sitter + WASM for everything). Skipping
 * them drops ~230 MB of prebuilt binaries and C sources.
 */
const SKIP = new Set([
  "tree-sitter-wasms", // not referenced anywhere in the analyzer source
  "tree-sitter-cpp",
  "tree-sitter-rust",
  "tree-sitter-vue",
  "tree-sitter-c",
  "tree-sitter-go",
  "nan",
  "node-addon-api",
  "node-gyp-build",
]);

function fail(msg) {
  console.error(`\n[bundle-cli] ${msg}\n`);
  process.exit(1);
}

if (!existsSync(join(distSrc, "cli.js"))) {
  fail(`analyzer build not found at ${distSrc}/cli.js — build the repo first:\n  (cd "${repoRoot}" && npm run build)`);
}

// ── Discover the production dependency closure ─────────────────────────────
// `npm ls` exits non-zero on peer/extraneous warnings but still prints the tree
// to stdout, so read stdout off the thrown error too.
let closure;
try {
  const out = execSync("npm ls --omit=dev --all --parseable", {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  closure = parseClosure(out);
} catch (err) {
  // npm ls exits non-zero on peer/extraneous warnings but still prints the tree.
  const out = err?.stdout?.toString?.() ?? "";
  closure = parseClosure(out);
  if (closure.length === 0) fail(`could not read the dependency closure via npm ls:\n${err?.message ?? err}`);
}

function parseClosure(out) {
  return [...new Set(
    out.split(/\r?\n/).map((s) => s.trim()).filter((p) => p && p !== repoRoot && p.includes(`node_modules`)),
  )];
}

// ── Clean & recreate ──────────────────────────────────────────────────────
rmSync(dest, { recursive: true, force: true });
mkdirSync(join(dest, "node_modules"), { recursive: true });

// ── dist/ — skip source maps and declarations (dead weight at runtime) ─────
cpSync(distSrc, join(dest, "dist"), {
  recursive: true,
  filter: (src) => !src.endsWith(".map") && !src.endsWith(".d.ts"),
});

// ── docker/ — LSP build contexts ──────────────────────────────────────────
// `dist/lsp-configs` resolves each language server's Dockerfile one level
// above dist/ (`clarifydoc/docker/<lang>`). Without this copy every LSP run
// failed to build its image and the analysis silently continued with
// `lspStats.serversUsed: []` — 44 KB of Dockerfiles for a working layer 2.
const dockerSrc = join(repoRoot, "docker");
if (!existsSync(dockerSrc)) fail(`LSP docker contexts not found at ${dockerSrc}`);
cpSync(dockerSrc, join(dest, "docker"), { recursive: true });

// ── Dependencies ───────────────────────────────────────────────────────────
let copied = 0;
const missingGrammarWasm = [];
for (const pkgDir of closure) {
  const name = pkgNameFromDir(pkgDir);
  const to = join(dest, "node_modules", ...name.split("/"));
  if (SKIP.has(name)) continue;
  mkdirSync(dirname(to), { recursive: true }); // create @scope/ dir when present

  if (isWasmGrammar(name)) {
    cpSync(pkgDir, to, {
      recursive: true,
      filter: (src) => statSafe(src)?.isDirectory() || src.endsWith(".wasm") || src.endsWith("package.json"),
    });
    if (!readdirRec(to).some((f) => f.endsWith(".wasm"))) missingGrammarWasm.push(name);
  } else if (name === "web-tree-sitter") {
    cpSync(pkgDir, to, { recursive: true, filter: (src) => !src.split(/[\\/]/).includes("debug") });
  } else {
    // Pure-JS runtime dep (commander, fast-glob and its closure) — copy whole.
    cpSync(pkgDir, to, { recursive: true });
  }
  copied++;
}

if (missingGrammarWasm.length) {
  fail(`no .wasm found for grammar package(s): ${missingGrammarWasm.join(", ")} — the repo may need its grammars built`);
}

// ── ESM marker so Node treats dist/*.js as modules under Electron-as-node ──
writeFileSync(
  join(dest, "package.json"),
  // The analyzer's own version: `TOOL_VERSION` walks up from dist/ and stops
  // here, so the bundled engine (its MCP serverInfo, every artifact's
  // provenance) reports the engine release it is, not the extension's.
  JSON.stringify({ name: "clarifydoc-bundled", version: rootVersion, private: true, type: "module" }, null, 2) + "\n",
);

console.log(`[bundle-cli] bundled analyzer → clarifydoc/  (${humanSize(dirSize(dest))}, ${copied} deps)`);

// ── helpers ────────────────────────────────────────────────────────────────
/** Package name (incl. @scope) from a node_modules path, e.g. …/@nodelib/fs.walk. */
function pkgNameFromDir(dir) {
  const parts = dir.split(/[\\/]/);
  const i = parts.lastIndexOf("node_modules");
  if (i === -1 || i + 1 >= parts.length) return basename(dir);
  const rest = parts.slice(i + 1);
  return rest[0].startsWith("@") && rest.length > 1 ? `${rest[0]}/${rest[1]}` : rest[0];
}
function statSafe(p) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}
function readdirRec(p) {
  const out = [];
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const full = join(p, e.name);
    if (e.isDirectory()) out.push(...readdirRec(full));
    else out.push(full);
  }
  return out;
}
function dirSize(p) {
  let total = 0;
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const full = join(p, e.name);
    total += e.isDirectory() ? dirSize(full) : statSafe(full)?.size ?? 0;
  }
  return total;
}
function humanSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}
