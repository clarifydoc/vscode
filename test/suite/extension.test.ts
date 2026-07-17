import * as assert from "assert";
import * as vscode from "vscode";

const EXT_ID = "clarifydoc.clarifydoc-vscode";

suite("ClarifyDoc extension", () => {
  test("is present", () => {
    assert.ok(vscode.extensions.getExtension(EXT_ID), "extension not found");
  });

  test("activates", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID)!;
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test("registers its commands", async () => {
    await vscode.extensions.getExtension(EXT_ID)!.activate();
    const cmds = await vscode.commands.getCommands(true);
    for (const c of [
      "clarifydoc.analyze",
      "clarifydoc.openReport",
      "clarifydoc.openReportSection",
      "clarifydoc.jumpTraces",
      "clarifydoc.goto",
      "clarifydoc.showCallers",
      "clarifydoc.revealSource",
    ]) {
      assert.ok(cmds.includes(c), `missing command ${c}`);
    }
  });

  test("contributes editor-intelligence settings and capabilities", () => {
    const pkg = vscode.extensions.getExtension(EXT_ID)!.packageJSON;
    const props = pkg.contributes.configuration.properties;
    assert.ok(props["clarifydoc.diagnostics.enabled"], "missing diagnostics.enabled");
    assert.ok(props["clarifydoc.codeLens.enabled"], "missing codeLens.enabled");
    assert.ok(props["clarifydoc.hover.enabled"], "missing hover.enabled");
    assert.strictEqual(pkg.capabilities.virtualWorkspaces.supported, false);
    assert.deepStrictEqual(pkg.extensionKind, ["workspace"]);
  });
});
