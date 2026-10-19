import { describe, expect, it } from "vitest";
import { gapIssueUrl, thinMapNotes } from "./thinMap";

describe("thinMapNotes", () => {
  it("names the server or frontend framework the map shows nothing of", () => {
    expect(thinMapNotes({
      files: 40,
      routes: 0,
      screens: 0,
      packages: [
        { name: "express", category: "framework", scope: "prod", used: true },
        { name: "react", category: "frontend", scope: "prod" },
        { name: "vitest", category: "testing", scope: "dev" },
      ],
    })).toEqual(["express is a dependency, yet no API route was found", "react is a dependency, yet no screen was found"]);
  });

  it("says nothing when the map has what the dependencies promise, or they are dev-only or unused", () => {
    const packages = [
      { name: "express", category: "framework", scope: "prod" },
      { name: "react", category: "frontend", scope: "dev" },
      { name: "koa", category: "framework", scope: "prod", used: false },
    ];
    expect(thinMapNotes({ files: 10, routes: 3, screens: 0, packages })).toEqual([]);
  });

  it("says when nothing was analyzed at all", () => {
    expect(thinMapNotes({ files: 0, routes: 0, screens: 0, packages: [] })[0]).toMatch(/no source file/);
  });
});

describe("gapIssueUrl", () => {
  it("prefills the notes, frameworks and versions — and no path", () => {
    const url = new URL(gapIssueUrl(["express is a dependency, yet no API route was found"], ["Express", "Prisma"], "0.1.13", "darwin"));
    expect(url.origin + url.pathname).toBe("https://github.com/clarifydoc/vscode/issues/new");
    expect(url.searchParams.get("title")).toBe("Analysis gap: express is a dependency, yet no API route was found");
    expect(url.searchParams.get("body")).toContain("**Detected frameworks:** Express, Prisma");
    expect(url.searchParams.get("body")).toContain("0.1.13");
  });
});
