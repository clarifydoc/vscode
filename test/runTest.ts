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
//   startup/    — only with CLARIFYDOC_STARTUP_PROJECT=<an analyzed project>:
//               the startup gate on that real project, opened in place, and
//               nothing else. A throwaway profile turns analyze on save off,
//               so the window reads the project and writes nothing into it.
const FIXTURES = ["sample-fullstack-cqrs", "sample-v-app", "sample-csharp-api", "sample-dead-code"];

/** A temp workspace: the fixture's source, with its analysis under `.clarifydoc/<name>/`. */
function fixtureWorkspace(monorepo: string, name: string): string | undefined {
  const source = path.join(monorepo, "test-fixtures", name);
  const analysis = path.join(monorepo, "test-output", name);
  if (!fs.existsSync(source) || !fs.existsSync(path.join(analysis, "project-summary.json"))) return undefined;
  const workspace = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "clarifydoc-fixture-")), name);
  fs.cpSync(source, workspace, { recursive: true });
  fs.cpSync(analysis, path.join(workspace, ".clarifydoc", name), { recursive: true });
  // A fixture's labels may turn settings on (dead code is off by default).
  const labels = path.join(__dirname, "..", "..", "test", "labels", `${name}.json`);
  const settings = fs.existsSync(labels) ? JSON.parse(fs.readFileSync(labels, "utf8")).settings : undefined;
  if (settings) {
    fs.mkdirSync(path.join(workspace, ".vscode"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".vscode", "settings.json"), JSON.stringify(settings, null, 2));
  }
  return workspace;
}

/** A fresh profile whose settings never start an analysis. */
function quietProfile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarifydoc-profile-"));
  fs.mkdirSync(path.join(dir, "User"), { recursive: true });
  fs.writeFileSync(path.join(dir, "User", "settings.json"), JSON.stringify({ "clarifydoc.analyzeOnSave": "off" }, null, 2));
  return dir;
}

async function main() {
  // A terminal inside VS Code exports ELECTRON_RUN_AS_NODE=1; the downloaded
  // Code binary inherits it and starts as plain Node ("bad option: --no-sandbox").
  delete process.env.ELECTRON_RUN_AS_NODE;
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
    const project = process.env.CLARIFYDOC_STARTUP_PROJECT;
    if (project) {
      await runTests({
        extensionDevelopmentPath,
        extensionTestsPath: path.resolve(__dirname, "startup", "index"),
        launchArgs: [path.resolve(project), "--disable-workspace-trust", "--disable-extensions", `--user-data-dir=${quietProfile()}`],
      });
      return;
    }
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
