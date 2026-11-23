import { readFileSync } from "node:fs";
import { build, context } from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** The bundled analyzer's version, compiled in so activation never reads it from disk ("" when not bundled). */
function bundledAnalyzerVersion() {
  try {
    const version = JSON.parse(readFileSync("clarifydoc/package.json", "utf8")).version;
    return typeof version === "string" ? version : "";
  } catch {
    return "";
  }
}

/**
 * Emits the begin/end markers the `$esbuild-watch`-style background problem
 * matcher in .vscode/tasks.json looks for, so VS Code knows when a rebuild
 * starts and finishes (and F5 can wait for the first build to complete).
 */
const statusPlugin = {
  name: "build-status",
  setup(b) {
    b.onStart(() => console.log("[watch] build started"));
    b.onEnd((result) => {
      for (const e of result.errors) {
        console.error(`✘ [ERROR] ${e.text}`);
        if (e.location) {
          console.error(`    ${e.location.file}:${e.location.line}:${e.location.column}:`);
        }
      }
      console.log("[watch] build finished");
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const options = {
  // The summary worker is its own file: a worker thread is started from a path (summaryThread.ts).
  entryPoints: { extension: "src/extension.ts", summaryWorker: "src/summaryWorker.ts" },
  bundle: true,
  outdir: "out",
  platform: "node",
  format: "cjs",
  target: "node18",
  // `vscode` is provided by the extension host at runtime and must never be bundled.
  external: ["vscode"],
  define: { __BUNDLED_ANALYZER_VERSION__: JSON.stringify(bundledAnalyzerVersion()) },
  sourcemap: !production,
  minify: production,
  logLevel: "silent",
  plugins: [statusPlugin],
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("[esbuild] watching for changes…");
} else {
  await build(options);
}
