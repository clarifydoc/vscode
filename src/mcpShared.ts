import * as fs from "fs/promises";
import * as path from "path";

/**
 * The parts of wiring the MCP server into shared agent config files that need
 * no editor API: the portable launcher, the local git exclude for a
 * machine-only file, and the arguments and report of the CLI's own undo.
 */

export interface ServerEntry {
  command: string;
  args?: string[];
}

/**
 * The entry a file that is committed (or may be) carries: the same on every
 * machine, found from the working directory, so a teammate's checkout runs it
 * without this machine's paths. It is NOT version-pinned, as the analyzer's own
 * installer writes it for a project file: the pinned form (`mcp --print-config
 * --pin`) goes stale in a shared file and nobody re-runs the installer for it,
 * while `npx -y clarifydoc` reads the analysis in `.clarifydoc/` with the
 * current reader, which opens older analyses. On Windows an app spawns
 * `npx.cmd` only through `cmd /c`, as the analyzer's installer does.
 */
export function portableEntry(platform: NodeJS.Platform = process.platform): ServerEntry {
  return platform === "win32"
    ? { command: "cmd", args: ["/c", "npx", "-y", "clarifydoc", "mcp"] }
    : { command: "npx", args: ["-y", "clarifydoc", "mcp"] };
}

async function isFile(p: string): Promise<boolean> {
  return fs.stat(p).then((s) => s.isFile(), () => false);
}
async function isDir(p: string): Promise<boolean> {
  return fs.stat(p).then((s) => s.isDirectory(), () => false);
}

/** The repository holding `start` and the directory its local `info/exclude` lives under, or undefined outside git. */
export async function gitLocation(start: string): Promise<{ top: string; gitDir: string } | undefined> {
  let dir = path.resolve(start);
  for (;;) {
    const dot = path.join(dir, ".git");
    if (await isDir(dot)) return { top: dir, gitDir: dot };
    if (await isFile(dot)) {
      // A linked worktree or submodule: `.git` is a file naming its git dir.
      const text = await fs.readFile(dot, "utf8").catch(() => "");
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
      if (!m) return undefined;
      let gitDir = path.resolve(dir, m[1]!);
      // A linked worktree keeps its own HEAD but shares `info/` with the main git dir (`commondir`).
      const common = (await fs.readFile(path.join(gitDir, "commondir"), "utf8").catch(() => "")).trim();
      if (common) gitDir = path.resolve(gitDir, common);
      return { top: dir, gitDir };
    }
    const up = path.dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/**
 * Keep a machine-only config file out of git without touching `.gitignore`:
 * one line in `.git/info/exclude`, added once. Resolves what happened.
 */
export async function excludeFromGit(file: string): Promise<"added" | "present" | "not-git"> {
  const loc = await gitLocation(path.dirname(file));
  if (!loc) return "not-git";
  const line = `/${path.relative(loc.top, file).split(path.sep).join("/")}`;
  const exclude = path.join(loc.gitDir, "info", "exclude");
  const text = await fs.readFile(exclude, "utf8").catch(() => "");
  if (text.split(/\r?\n/).some((l) => l.trim() === line)) return "present";
  await fs.mkdir(path.dirname(exclude), { recursive: true });
  await fs.writeFile(exclude, `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${line}\n`, "utf8");
  return "added";
}

/** What the analyzer's `install --remove --json` prints. */
export interface RemovalReport {
  removed: string[];
  edited: string[];
  skipped: Array<{ file: string; reason: string }>;
  errors: Array<{ file: string; error: string }>;
}

/** The analyzer arguments that undo `install` for a project: the clients named, or every client when none. */
export function removeArgs(root: string, clients: readonly string[], preview: boolean): string[] {
  return ["install", root, "--remove", "--json", ...(preview ? ["--print"] : []), ...(clients.length ? ["--client", ...clients] : [])];
}

export function parseRemovalReport(stdout: string): RemovalReport | undefined {
  try {
    const r = JSON.parse(stdout) as Partial<RemovalReport>;
    if (!Array.isArray(r.removed) || !Array.isArray(r.edited)) return undefined;
    return { removed: r.removed, edited: r.edited, skipped: r.skipped ?? [], errors: r.errors ?? [] };
  } catch {
    return undefined;
  }
}

/** One line per file, said the way a person reads it. */
export function describeRemoval(report: RemovalReport, root: string): string[] {
  const rel = (f: string) => path.relative(root, f).split(path.sep).join("/") || f;
  return [
    ...report.removed.map((f) => `Deleted ${rel(f)}`),
    ...report.edited.map((f) => `Removed our entry from ${rel(f)}`),
    ...report.skipped.map((s) => `Left ${rel(s.file)} as it is: ${s.reason}`),
    ...report.errors.map((e) => `Could not change ${rel(e.file)}: ${e.error}`),
  ];
}

/** The analyzer's client names for the targets we install into, to remember what to undo. */
export const CLIENT_OF_TARGET = {
  "Claude Code (this project)": "claude-code",
  Cursor: "cursor",
  "Cursor (this project)": "cursor",
  Windsurf: "windsurf",
  "Gemini CLI (this project)": "gemini",
  Codex: "codex",
  "Claude Desktop": "claude-desktop",
} as const;
