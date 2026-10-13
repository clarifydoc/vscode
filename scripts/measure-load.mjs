// What reading an analysis costs the extension host (VSCODE-PLAN.md step 1.1).
//
//   node --expose-gc scripts/measure-load.mjs <analysis-dir>...
//
// Each <analysis-dir> holds a project-summary.json. For each, prints the file
// size, then time and retained heap for:
//   load   — loadReportSummary: parse + denormalize + LSP merge
//   index  — the extension's own indexProject (src/analysisData.ts)
//   store  — the MCP store's buildIndex, which the extension would adopt
// Uses the bundled analyzer in clarifydoc/ (run `npm run bundle` first).
import * as esbuild from "esbuild";
import { mkdtempSync, statSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { pathToFileURL, fileURLToPath } from "url";

if (typeof globalThis.gc !== "function") {
  console.error("run with node --expose-gc");
  process.exit(1);
}
const dirs = process.argv.slice(2).map((d) => resolve(d));
if (dirs.length === 0) {
  console.error("usage: node --expose-gc scripts/measure-load.mjs <analysis-dir>...");
  process.exit(1);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const analyzer = await import(pathToFileURL(join(root, "clarifydoc/dist/index.js")).href);
if (typeof analyzer.buildIndex !== "function") {
  console.error("the bundled analyzer does not export buildIndex — rebuild cli/ and run npm run bundle");
  process.exit(1);
}

// The extension's indexer, bundled with the unit tests' stand-in for `vscode`.
const out = join(mkdtempSync(join(tmpdir(), "measure-load-")), "analysisData.mjs");
await esbuild.build({
  entryPoints: [join(root, "src/analysisData.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  alias: { vscode: join(root, "test/mocks/vscode.ts") },
  logLevel: "error",
});
const { indexProject } = await import(pathToFileURL(out).href);

const heap = () => {
  globalThis.gc();
  globalThis.gc();
  return process.memoryUsage().heapUsed;
};
const mb = (bytes) => `${(bytes / 1048576).toFixed(0)} MB`;

/** Run `fn`, keep its result alive, report time and the heap it retains. */
async function measure(fn) {
  const before = heap();
  const t0 = performance.now();
  const value = await fn();
  const ms = performance.now() - t0;
  const retained = heap() - before;
  return { value, text: `${ms.toFixed(0).padStart(6)} ms ${mb(retained).padStart(7)}` };
}

console.log("| analysis | summary file | load | index (extension) | buildIndex (store) |");
console.log("|---|---|---|---|---|");
for (const dir of dirs) {
  const size = statSync(join(dir, "project-summary.json")).size;
  const load = await measure(() => analyzer.loadReportSummary(dir));
  const ext = await measure(() => indexProject(load.value));
  const store = await measure(() => analyzer.buildIndex(load.value));
  const name = dir.split("/").slice(-2).join("/");
  console.log(`| ${name} | ${mb(size)} | ${load.text} | ${ext.text} | ${store.text} |`);
  load.value = ext.value = store.value = undefined;
}
