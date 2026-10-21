import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { runClarifyDoc } from "./cli";

const bundled = path.resolve(__dirname, "../clarifydoc/dist/cli.js");
const fixture = path.resolve(__dirname, "../../test-fixtures/sample-backend/services/playerService.ts");

describe.skipIf(!fs.existsSync(bundled) || !fs.existsSync(fixture))("runClarifyDoc", () => {
  const cli = { command: process.execPath, baseArgs: [bundled], electronAsNode: false, display: "test" };

  it("sends stdin to the analyzer: cfg draws the unsaved buffer", async () => {
    const buffer = "export function unsaved(x: number) {\n  if (x > 1) return x;\n  return 0;\n}\n";
    const result = await runClarifyDoc(cli, ["cfg", fixture, "--stdin", "--format", "json", "--no-styled"], {
      cwd: path.dirname(fixture),
      stdin: buffer,
    });
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.diagrams.map((d: { cfg: { functionName: string } }) => d.cfg.functionName)).toEqual(["unsaved"]);
  });

  it("does not keep stdout it was told only to stream", async () => {
    const chunks: string[] = [];
    const result = await runClarifyDoc(cli, ["detect", "--json"], {
      cwd: path.dirname(fixture),
      captureStdout: false,
      onOutput: (c) => chunks.push(c),
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(JSON.parse(chunks.join("")).analyzableExtensions).toContain(".ts");
  });
});
