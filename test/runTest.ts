import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runTests } from "@vscode/test-electron";

// Downloads a VS Code build (cached after first run) and launches the extension
// host with our compiled test suites. Run with `npm test`.
//
//   suite/    — no workspace: activation, commands, manifest.
//   fixture/  — once per labelled fixture, in a workspace that holds the
//               fixture's source and its analysis, the way an analyzed project
//               looks. Needs the monorepo (test-fixtures/, test-output/);
//               skipped in a bare checkout of the extension.
const FIXTURES = ["sample-fullstack-cqrs", "sample-v-app", "sample-csharp-api"];

/** A temp workspace: the fixture's source, with its analysis under `.clarifydoc/<name>/`. */
function fixtureWorkspace(monorepo: string, name: string): string | undefined {
  const source = path.join(monorepo, "test-fixtures", name);
  const analysis = path.join(monorepo, "test-output", name);
  if (!fs.existsSync(source) || !fs.existsSync(path.join(analysis, "project-summary.json"))) return undefined;
  const workspace = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "clarifydoc-fixture-")), name);
  fs.cpSync(source, workspace, { recursive: true });
  fs.cpSync(analysis, path.join(workspace, ".clarifydoc", name), { recursive: true });
  return workspace;
}

async function main() {
  // A terminal inside VS Code exports ELECTRON_RUN_AS_NODE=1; the downloaded
  // Code binary inherits it and starts as plain Node ("bad option: --no-sandbox").
  delete process.env.ELECTRON_RUN_AS_NODE;
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
    await runTests({ extensionDevelopmentPath, extensionTestsPath: path.resolve(__dirname, "suite", "index") });

    const monorepo = path.resolve(extensionDevelopmentPath, "..");
    for (const name of FIXTURES) {
      const workspace = fixtureWorkspace(monorepo, name);
      if (!workspace) {
        console.log(`[fixture] ${name}: no fixture or analysis beside the extension — skipped`);
        continue;
      }
      await runTests({
        extensionDevelopmentPath,
        extensionTestsPath: path.resolve(__dirname, "fixture", "index"),
        launchArgs: [workspace, "--disable-workspace-trust", "--disable-extensions"],
        extensionTestsEnv: { CLARIFYDOC_FIXTURE: name },
      });
    }
  } catch (err) {
    console.error("Failed to run tests:", err);
    process.exit(1);
  }
}

void main();
