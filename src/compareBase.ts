/**
 * What the Impact view compares the working tree against. By default that is
 * HEAD — "what do my uncommitted changes reach". Comparing with a branch makes
 * it "what does this branch reach", the question a pull request asks; for that
 * the diff starts at the merge-base, so work that landed on the target branch
 * after this one forked is not counted as this branch's. vscode-free.
 */

export interface CompareBase {
  /** What the user picked, as they would recognise it: `main`, `v2.1`, `a1b2c3d`. */
  label: string;
  /** The commit passed to `clarifydoc impact --base`: the merge-base with HEAD where one exists. */
  commit: string;
}

export interface RefChoice {
  ref: string;
  kind: "branch" | "remote" | "tag";
  /** Relative age as git words it ("3 days ago"). */
  when: string;
}

/**
 * Parse `git for-each-ref --format=%(refname)%09%(committerdate:relative)`
 * output. `origin/HEAD` is dropped: it is an alias, not a branch anyone means.
 */
export function parseRefs(stdout: string): RefChoice[] {
  const out: RefChoice[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [full, when = ""] = line.split("\t");
    if (!full) continue;
    let kind: RefChoice["kind"];
    let ref: string;
    if (full.startsWith("refs/heads/")) {
      kind = "branch";
      ref = full.slice("refs/heads/".length);
    } else if (full.startsWith("refs/remotes/")) {
      kind = "remote";
      ref = full.slice("refs/remotes/".length);
      if (ref.endsWith("/HEAD")) continue;
    } else if (full.startsWith("refs/tags/")) {
      kind = "tag";
      ref = full.slice("refs/tags/".length);
    } else continue;
    out.push({ ref, kind, when: when.trim() });
  }
  return out;
}

/** The view description: nothing for HEAD (the default needs no caption). */
export function describeBase(base: CompareBase | undefined): string | undefined {
  return base ? `vs ${base.label}` : undefined;
}
