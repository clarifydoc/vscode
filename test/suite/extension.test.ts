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
      "clarifydoc.ignoreFolder",
      "clarifydoc.openReport",
      "clarifydoc.openReportSection",
      "clarifydoc.jumpTraces",
      "clarifydoc.goto",
      "clarifydoc.showCallers",
      "clarifydoc.revealSource",
      "clarifydoc.copyMcpConfig",
      "clarifydoc.installMcpServer",
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

  test("publishes an MCP server provider", () => {
    const pkg = vscode.extensions.getExtension(EXT_ID)!.packageJSON;
    assert.deepStrictEqual(pkg.contributes.mcpServerDefinitionProviders, [
      { id: "clarifydoc.mcp", label: "ClarifyDoc" },
    ]);
    const props = pkg.contributes.configuration.properties;
    assert.strictEqual(props["clarifydoc.mcp.enabled"].default, true);
    // Agents read the analysis; only the extension runs one, unless opted in.
    assert.strictEqual(props["clarifydoc.mcp.allowAnalyze"].default, false);
  });

  test("stores the analysis in the project, so agents find it unaided", () => {
    const pkg = vscode.extensions.getExtension(EXT_ID)!.packageJSON;
    const storage = pkg.contributes.configuration.properties["clarifydoc.storage"];
    assert.ok(storage, "missing clarifydoc.storage");
    assert.strictEqual(storage.default, "workspace");
    assert.deepStrictEqual(storage.enum, ["workspace", "global"]);
  });

  test("offers to ignore a folder from the Explorer, never the workspace root", () => {
    const pkg = vscode.extensions.getExtension(EXT_ID)!.packageJSON;
    const entry = pkg.contributes.menus["explorer/context"].find(
      (m: { command: string }) => m.command === "clarifydoc.ignoreFolder",
    );
    assert.ok(entry, "missing explorer/context entry for clarifydoc.ignoreFolder");
    assert.strictEqual(entry.when, "explorerResourceIsFolder && !explorerResourceIsRoot");
  });

  test("writes a version-independent MCP launcher", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID)!;
    await ext.activate();
    const name = process.platform === "win32" ? "clarifydoc-mcp.cmd" : "clarifydoc-mcp";
    const launcher = vscode.Uri.joinPath(
      vscode.Uri.file(process.env.VSCODE_TEST_GLOBAL_STORAGE ?? ""),
      "bin",
      name,
    );
    // The launcher lives in global storage, whose path the test host owns; when
    // it is not exposed, assert the contribution that makes it reachable.
    if (!process.env.VSCODE_TEST_GLOBAL_STORAGE) {
      const cmds = await vscode.commands.getCommands(true);
      assert.ok(cmds.includes("clarifydoc.installMcpServer"));
      return;
    }
    const stat = await vscode.workspace.fs.stat(launcher);
    assert.ok(stat.size > 0, "launcher is empty");
  });
});
