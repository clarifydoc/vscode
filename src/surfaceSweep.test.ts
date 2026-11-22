import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { sweepTrees } from "./surfaceSweep";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

describe("sweepTrees", () => {
  let root: string;
  let repo: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cd-sweep-"));
    repo = path.join(root, "garage");
    fs.mkdirSync(repo);
    git(repo, "init", "-q");
    git(repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "first");
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("removes the worktrees an earlier run left, prunes git's list, and leaves other tools' worktrees alone", async () => {
    const trees = path.join(root, "storage", "trees");
    fs.mkdirSync(trees, { recursive: true });
    const leftover = path.join(trees, "base-0123456789ab");
    const foreign = path.join(trees, "match-review");
    const elsewhere = path.join(root, "other-tool-tree");
    git(repo, "worktree", "add", "-q", "--detach", leftover, "HEAD");
    git(repo, "worktree", "add", "-q", "--detach", foreign, "HEAD");
    git(repo, "worktree", "add", "-q", "--detach", elsewhere, "HEAD");
    // a second one whose directory vanished without git hearing of it
    const gone = path.join(trees, "base-abcdef012345");
    git(repo, "worktree", "add", "-q", "--detach", gone, "HEAD");
    fs.rmSync(gone, { recursive: true, force: true });

    const removed = await sweepTrees(repo, trees);

    expect(removed.sort()).toEqual(["base-0123456789ab"]);
    expect(fs.existsSync(leftover)).toBe(false);
    expect(fs.existsSync(foreign)).toBe(true);
    expect(fs.existsSync(elsewhere)).toBe(true);
    const listed = git(repo, "worktree", "list", "--porcelain");
    expect(listed).not.toContain("base-0123456789ab");
    expect(listed).not.toContain("base-abcdef012345");
    expect(listed).toContain("match-review");
    expect(listed).toContain("other-tool-tree");
  });

  it("keeps the tree a live run names, and does nothing without a trees folder", async () => {
    const trees = path.join(root, "storage2", "trees");
    fs.mkdirSync(trees, { recursive: true });
    const live = path.join(trees, "base-1111111111aa");
    git(repo, "worktree", "add", "-q", "--detach", live, "HEAD");
    expect(await sweepTrees(repo, trees, ["base-1111111111aa"])).toEqual([]);
    expect(fs.existsSync(live)).toBe(true);
    expect(await sweepTrees(repo, path.join(root, "missing"))).toEqual([]);
  });
});
