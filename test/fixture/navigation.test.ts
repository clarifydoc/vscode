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
  hierarchy: { file: string; line: number; symbol: string; incoming: string[]; outgoing: string[] }[];
  findings: { file: string; line: number; code: string; reachedFrom: { file: string; lines: number[] }[] }[];
}

/** Diagnostics are published after activation reads the analysis; wait for them. */
async function diagnosticsFor(uri: vscode.Uri): Promise<vscode.Diagnostic[]> {
  for (let i = 0; i < 100; i++) {
    const found = vscode.languages.getDiagnostics(uri).filter((d) => d.source === "ClarifyDoc");
    if (found.length) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
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
    for (const call of labels.calls) {
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
    }
  });

  test("the call hierarchy crosses the HTTP boundary", async () => {
    for (const h of labels.hierarchy) {
      const doc = await open(h.file);
      const [item] = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
        "vscode.prepareCallHierarchy",
        doc.uri,
        new vscode.Position(h.line - 1, doc.lineAt(h.line - 1).text.indexOf(h.symbol.split(".").pop()!)),
      );
      assert.ok(item, `no hierarchy at ${h.file}:${h.line}`);
      assert.strictEqual(item.name, h.symbol);
      const incoming = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>("vscode.provideIncomingCalls", item);
      const outgoing = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>("vscode.provideOutgoingCalls", item);
      const name = (i: vscode.CallHierarchyItem) => `${relOf(i.uri)}#${i.name}`;
      assert.deepStrictEqual(incoming.map((c) => name(c.from)).sort(), [...h.incoming].sort());
      for (const want of h.outgoing) {
        assert.ok(outgoing.map((c) => name(c.to)).includes(want), `${want} not in ${JSON.stringify(outgoing.map((c) => name(c.to)))}`);
      }
    }
  });

  test("a security finding names its CWE and the routes that reach it", async () => {
    for (const f of labels.findings) {
      const uri = vscode.Uri.file(path.join(root(), f.file));
      const diags = await diagnosticsFor(uri);
      const d = diags.find((x) => x.range.start.line === f.line - 1 && typeof x.code === "object");
      assert.ok(d, `no finding at ${f.file}:${f.line}: ${JSON.stringify(diags.map((x) => [x.range.start.line, x.code]))}`);
      assert.strictEqual((d.code as { value: string }).value, f.code);
      const related = (d.relatedInformation ?? []).map((r) => ({ file: relOf(r.location.uri), line: r.location.range.start.line + 1 }));
      for (const want of f.reachedFrom) {
        assert.ok(
          related.some((r) => r.file === want.file && want.lines.includes(r.line)),
          `${want.file}:${want.lines.join("|")} not in ${JSON.stringify(related)}`,
        );
      }
    }
  });

  test("a security finding offers its routes as a quick fix", async () => {
    for (const f of labels.findings) {
      const doc = await open(f.file);
      await diagnosticsFor(doc.uri);
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        "vscode.executeCodeActionProvider",
        doc.uri,
        new vscode.Range(f.line - 1, 0, f.line - 1, 1),
      );
      const titles = actions.map((a) => a.title);
      assert.ok(titles.includes("Show the route that reaches this"), JSON.stringify(titles));
    }
  });
});
