import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { END, mergeGuidance, START } from "./guidanceMerge";

const g = "## ClarifyDoc\n\nUse it.\n";

describe("mergeGuidance", () => {
  it("appends a marked section to an existing file, after a blank line", () => {
    expect(mergeGuidance("# Project\n\nRules.\n", g)).toBe(`# Project\n\nRules.\n\n${START}\n## ClarifyDoc\n\nUse it.\n${END}\n`);
  });

  it("replaces only its own section on a second run", () => {
    const once = mergeGuidance("# Project\n", g) + "\n## Later\n";
    const twice = mergeGuidance(once, "## ClarifyDoc\n\nUse it more.\n");
    expect(twice).toContain("Use it more.");
    expect(twice).not.toContain("Use it.\n");
    expect(twice.startsWith("# Project\n")).toBe(true);
    expect(twice.endsWith("\n## Later\n")).toBe(true);
    expect(twice.split(START).length).toBe(2);
  });

  it("writes a new file with an optional header", () => {
    expect(mergeGuidance(undefined, g, "H\n")).toBe(`H\n${START}\n## ClarifyDoc\n\nUse it.\n${END}\n`);
  });
});

// What installAgentGuidance and askAgent read from the bundled analyzer.
const bundled = path.resolve(__dirname, "../clarifydoc/dist/index.js");

describe.skipIf(!fs.existsSync(bundled))("the bundled analyzer's agent exports", () => {
  it("has guidance that merges as one marked section", async () => {
    const m = await import(pathToFileURL(bundled).href);
    const merged = mergeGuidance("# Project\n", m.AGENT_GUIDANCE);
    expect(merged).toContain("## ClarifyDoc");
    expect(merged.split(START).length).toBe(2);
  });

  it("has workflows whose arguments the cursor context can fill", async () => {
    const m = await import(pathToFileURL(bundled).href);
    const fillable = new Set(["file", "symbol", "path", "method", "screen", "feature", "base", "what", "package"]);
    for (const p of m.WORKFLOW_PROMPTS as { name: string; arguments: { name: string }[] }[]) {
      for (const a of p.arguments) expect(fillable.has(a.name), `${p.name}: ${a.name}`).toBe(true);
    }
  });
});
