// Stage the Mermaid browser bundle into media/vendor/ so the control-flow
// webview can load it as a local script.
//
// Copied at build time rather than committed: it is 5 MB of generated
// third-party code, and the version that ships should be the one package.json
// resolves, not whatever was checked in months ago. media/vendor/ is
// gitignored for the same reason.
//
// The webview cannot reach node_modules (`.vscodeignore` keeps it out of the
// VSIX, and a webview may only load files under the extension root anyway), so
// a copy is the only way in.
import { mkdir, copyFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const SOURCE = join(root, "node_modules", "mermaid", "dist", "mermaid.min.js");
const TARGET_DIR = join(root, "media", "vendor");
const TARGET = join(TARGET_DIR, "mermaid.min.js");

try {
  const info = await stat(SOURCE);
  await mkdir(TARGET_DIR, { recursive: true });
  await copyFile(SOURCE, TARGET);
  console.log(`copy-mermaid: ${(info.size / 1024 / 1024).toFixed(1)} MB → media/vendor/mermaid.min.js`);
} catch (error) {
  console.error(
    "copy-mermaid: could not stage mermaid.min.js — run `npm install` in VsCode/ first.",
  );
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
