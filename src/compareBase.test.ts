import { describe, expect, it } from "vitest";
import { describeBase, parseRefs } from "./compareBase";

describe("parseRefs", () => {
  it("reads branches, remote branches and tags, newest first as git gave them", () => {
    const out = [
      "refs/heads/main\t2 hours ago",
      "refs/heads/feature/x\t3 days ago",
      "refs/remotes/origin/HEAD\t2 hours ago",
      "refs/remotes/origin/main\t2 hours ago",
      "refs/tags/v1.2.0\t5 weeks ago",
      "refs/stash\t1 day ago",
      "",
    ].join("\n");
    expect(parseRefs(out)).toEqual([
      { ref: "main", kind: "branch", when: "2 hours ago" },
      { ref: "feature/x", kind: "branch", when: "3 days ago" },
      { ref: "origin/main", kind: "remote", when: "2 hours ago" },
      { ref: "v1.2.0", kind: "tag", when: "5 weeks ago" },
    ]);
  });

  it("tolerates CRLF and a missing date", () => {
    expect(parseRefs("refs/heads/a\r\nrefs/heads/b\t\r\n")).toEqual([
      { ref: "a", kind: "branch", when: "" },
      { ref: "b", kind: "branch", when: "" },
    ]);
  });
});

describe("describeBase", () => {
  it("captions only a non-default base", () => {
    expect(describeBase(undefined)).toBeUndefined();
    expect(describeBase({ label: "main", commit: "abc" })).toBe("vs main");
  });
});
