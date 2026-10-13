import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

// Runs in a workspace holding one fixture and its analysis (see runTest.ts),
// checking the cross-tier providers through VS Code's own commands against
// labels written by hand from the fixture's source (test/labels/).
const EXT_ID = "clarifydoc.clarifydoc-vscode";
const fixture = process.env.CLARIFYDOC_FIXTURE ?? "";
const labelsFile = path.resolve(__dirname, "../../../test/labels", `${fixture}.json`);

interface Labels {
  calls: { file: string; line: number; url: string; route: { file: string; line: number } }[];
  routes: { file: string; line: number; callers: string[]; lens: string }[];
  notCalls: { file: string; line: number }[];
}

function root(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "the fixture suite needs a workspace folder");
  return folder.uri.fsPath;
}

async function open(rel: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root(), rel)));
}

const relOf = (uri: vscode.Uri) => path.relative(root(), uri.fsPath).split(path.sep).join("/");

suite(`Cross-tier navigation: ${fixture}`, () => {
  const labels = JSON.parse(fs.readFileSync(labelsFile, "utf8")) as Labels;

  suiteSetup(async () => {
    await vscode.extensions.getExtension(EXT_ID)!.activate();
  });

  test("Go to Definition on a call's URL opens the route that serves it", async () => {
    for (const call of labels.calls) {
      const doc = await open(call.file);
      const text = doc.lineAt(call.line - 1).text;
      const col = text.indexOf(call.url);
      assert.ok(col >= 0, `${call.url} not on ${call.file}:${call.line}`);
      const defs = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        "vscode.executeDefinitionProvider",
        doc.uri,
        new vscode.Position(call.line - 1, col + 1),
      );
      const ours = defs
        .map((d) => ("targetUri" in d ? { uri: d.targetUri, line: d.targetRange.start.line } : { uri: d.uri, line: d.range.start.line }))
        .map((d) => `${relOf(d.uri)}:${d.line + 1}`);
      assert.deepStrictEqual(ours, [`${call.route.file}:${call.route.line}`], `${call.file}:${call.line}`);
    }
  });

  test("Go to Definition offers no route where no call is", async () => {
    for (const at of labels.notCalls) {
      const doc = await open(at.file);
      const defs = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        "vscode.executeDefinitionProvider",
        doc.uri,
        new vscode.Position(at.line - 1, 4),
      );
      const routeFiles = new Set(labels.routes.map((r) => r.file));
      const ours = defs.filter((d) => routeFiles.has(relOf("targetUri" in d ? d.targetUri : d.uri)));
      assert.deepStrictEqual(ours, [], `${at.file}:${at.line}`);
    }
  });

  test("Find References on a route lists the calls that reach it", async () => {
    for (const route of labels.routes) {
      const doc = await open(route.file);
      const refs = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeReferenceProvider",
        doc.uri,
        new vscode.Position(route.line - 1, 0),
      );
      const ours = refs.map((r) => `${relOf(r.uri)}:${r.range.start.line + 1}`).filter((r) => !r.startsWith(route.file));
      assert.deepStrictEqual(ours.sort(), [...route.callers].sort(), `${route.file}:${route.line}`);
    }
  });

  test("a route's CodeLens says who calls it and what it stores", async () => {
    for (const route of labels.routes) {
      const doc = await open(route.file);
      const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", doc.uri, 50);
      const titles = lenses.filter((l) => l.range.start.line === route.line - 1).map((l) => l.command?.title ?? "");
      assert.ok(titles.includes(route.lens), `${route.file}:${route.line} lenses: ${JSON.stringify(titles)}`);
    }
  });

  test("hovering a call names the route it reaches", async () => {
    const call = labels.calls[0];
    const doc = await open(call.file);
    const col = doc.lineAt(call.line - 1).text.indexOf(call.url);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      doc.uri,
      new vscode.Position(call.line - 1, col + 1),
    );
    // Markdown source: analyzer text arrives backslash-escaped.
    const text = hovers
      .flatMap((h) => h.contents.map((c) => (typeof c === "string" ? c : c.value)))
      .join("\n")
      .replace(/\\/g, "");
    assert.ok(text.includes(`${path.basename(call.route.file)}:${call.route.line}`), text);
  });
});
