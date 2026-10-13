// Fail when the packaged VSIX grows more than 20% over the recorded baseline.
// The package doubled once (4.4 MB → 8.8 MB at 0.1.7) without anyone deciding
// it should; this makes growth a decision, recorded in vsix-size.json.
//
//   node scripts/vsix-size.mjs [file.vsix]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const file = process.argv[2] ?? join(root, `clarifydoc-vscode-${version}.vsix`);
const { bytes: baseline } = JSON.parse(readFileSync(join(root, "scripts", "vsix-size.json"), "utf8"));
const MB = (n) => `${(n / 1048576).toFixed(2)} MB`;

let size;
try {
  size = statSync(file).size;
} catch {
  const found = readdirSync(root).filter((f) => f.endsWith(".vsix"));
  console.error(`no ${file}; packages here: ${found.join(", ") || "none"}`);
  process.exit(1);
}
const growth = (size - baseline) / baseline;
console.log(`VSIX ${MB(size)} (baseline ${MB(baseline)}, ${growth >= 0 ? "+" : ""}${(growth * 100).toFixed(1)}%)`);
if (growth > 0.2) {
  console.error(`The VSIX grew more than 20%. If that is intended, raise "bytes" in scripts/vsix-size.json in the same commit and say why.`);
  process.exit(1);
}
