import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { describeRemoval, excludeFromGit, parseRemovalReport, portableEntry, removeArgs } from "./mcpShared";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "cd-mcp-"));
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8")) as {
  contributes: { commands: { command: string; title: string }[]; menus: Record<string, { command?: string }[]> };
};

describe("portable entry", () => {
  it("is the unpinned npx launcher, through cmd on Windows", () => {
    expect(portableEntry("linux")).toEqual({ command: "npx", args: ["-y", "clarifydoc", "mcp"] });
    expect(portableEntry("win32")).toEqual({ command: "cmd", args: ["/c", "npx", "-y", "clarifydoc", "mcp"] });
  });
});

describe("excludeFromGit", () => {
  it("adds the file once to .git/info/exclude and never creates .gitignore", async () => {
    const root = tmp();
    mkdirSync(path.join(root, ".git", "info"), { recursive: true });
    writeFileSync(path.join(root, ".git", "info", "exclude"), "# local\n*.log");
    const file = path.join(root, ".mcp.json");
    expect(await excludeFromGit(file)).toBe("added");
    expect(await excludeFromGit(file)).toBe("present");
    expect(readFileSync(path.join(root, ".git", "info", "exclude"), "utf8")).toBe("# local\n*.log\n/.mcp.json\n");
    expect(existsSync(path.join(root, ".gitignore"))).toBe(false);
  });

  it("creates info/exclude when missing, and names a nested folder's file from the repository top", async () => {
    const root = tmp();
    mkdirSync(path.join(root, ".git"));
    mkdirSync(path.join(root, "club-app"));
    expect(await excludeFromGit(path.join(root, "club-app", ".mcp.json"))).toBe("added");
    expect(readFileSync(path.join(root, ".git", "info", "exclude"), "utf8")).toBe("/club-app/.mcp.json\n");
  });

  it("does nothing outside a git repository", async () => {
    const root = tmp();
    expect(await excludeFromGit(path.join(root, ".mcp.json"))).toBe("not-git");
    expect(existsSync(path.join(root, ".git"))).toBe(false);
  });

  it("follows a worktree's .git file to the shared git dir", async () => {
    const main = tmp();
    const common = path.join(main, ".git");
    const gitDir = path.join(common, "worktrees", "garage");
    mkdirSync(gitDir, { recursive: true });
    writeFileSync(path.join(gitDir, "commondir"), "../..\n");
    const wt = tmp();
    writeFileSync(path.join(wt, ".git"), `gitdir: ${gitDir}\n`);
    expect(await excludeFromGit(path.join(wt, ".mcp.json"))).toBe("added");
    expect(readFileSync(path.join(common, "info", "exclude"), "utf8")).toBe("/.mcp.json\n");
    expect(existsSync(path.join(gitDir, "info", "exclude"))).toBe(false);
  });

  it("follows a submodule's relative .git file (no commondir) to its own git dir", async () => {
    const root = tmp();
    mkdirSync(path.join(root, ".git", "modules", "league"), { recursive: true });
    mkdirSync(path.join(root, "league"));
    writeFileSync(path.join(root, "league", ".git"), "gitdir: ../.git/modules/league\n");
    expect(await excludeFromGit(path.join(root, "league", ".mcp.json"))).toBe("added");
    expect(readFileSync(path.join(root, ".git", "modules", "league", "info", "exclude"), "utf8")).toBe("/.mcp.json\n");
  });
});

describe("removal through the analyzer", () => {
  it("asks install --remove for the agents set up, previewing with --print", () => {
    expect(removeArgs("/work/club", ["claude-code", "cursor"], false)).toEqual(["install", "/work/club", "--remove", "--json", "--client", "claude-code", "cursor"]);
    expect(removeArgs("/work/club", ["codex"], true)).toEqual(["install", "/work/club", "--remove", "--json", "--print", "--client", "codex"]);
    expect(removeArgs("/work/club", [], false)).toEqual(["install", "/work/club", "--remove", "--json"]);
  });

  it("reads the report and says what was removed, edited, skipped and failed", () => {
    const out = JSON.stringify({
      removed: ["/work/club/.mcp.json"],
      edited: ["/work/club/.cursor/mcp.json"],
      skipped: [{ file: "/work/club/AGENTS.md", reason: "unbalanced markers" }],
      errors: [{ file: "/work/club/.gemini/settings.json", error: "EACCES" }],
    });
    const report = parseRemovalReport(out)!;
    expect(describeRemoval(report, "/work/club")).toEqual([
      "Deleted .mcp.json",
      "Removed our entry from .cursor/mcp.json",
      "Left AGENTS.md as it is: unbalanced markers",
      "Could not change .gemini/settings.json: EACCES",
    ]);
    expect(parseRemovalReport("not json")).toBeUndefined();
  });
});

describe("remove contribution", () => {
  it("is a titled command in the sidebar menu", () => {
    const c = pkg.contributes.commands.find((x) => x.command === "clarifydoc.removeAgentConfigs");
    expect(c?.title).toMatch(/Remove ClarifyDoc/);
    expect(pkg.contributes.menus["view/title"]!.some((m) => m.command === "clarifydoc.removeAgentConfigs")).toBe(true);
  });
});
