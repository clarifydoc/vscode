import { describe, expect, it } from "vitest";
import { issueReport, languageCounts, type IssueInput } from "./issueReport";

const input: IssueInput = {
  kind: "gap",
  extension: "0.7.0",
  analyzer: "1.155.0",
  editor: "Visual Studio Code 1.105.0",
  os: "darwin 25.0.0 arm64",
  settings: { storage: "workspace", editorLsp: true },
  folders: [
    {
      analysis: {
        analyzedAt: "2026-10-19T10:00:00.000Z",
        files: 42,
        languages: languageCounts(["src/a.ts", "src/b.ts", "src/c.tsx", "Dockerfile"]),
        frameworks: ["Express", "React"],
        subProjects: 2,
        routes: 0,
        screens: 5,
        apiCalls: 9,
        unplaced: { unmatched: 3, "method-mismatch": 0 },
        thin: { parse: 1, imports: 2 },
        notes: ["express is a dependency, yet no API route was found"],
      },
    },
    {},
  ],
};

describe("issueReport", () => {
  it("prefills versions, settings and per-folder counts", () => {
    const { title, body, url } = issueReport(input, "express routes not found");
    expect(title).toBe("Analysis gap: express routes not found");
    expect(body).toContain("ClarifyDoc extension 0.7.0 · analyzer 1.155.0");
    expect(body).toContain("Visual Studio Code 1.105.0 · darwin 25.0.0 arm64");
    expect(body).toContain("settings: storage=workspace, editorLsp=true");
    expect(body).toContain("**Folder 1** (analyzed 2026-10-19)");
    expect(body).toContain("42 files: .ts 2, (none) 1, .tsx 1");
    expect(body).toContain("frameworks: Express, React · 2 sub-projects");
    expect(body).toContain("calls reaching no route: 3 unmatched");
    expect(body).not.toContain("method-mismatch");
    expect(body).toContain("1 files read in part, 2 with relative imports");
    expect(body).toContain("**Folder 2**: not analyzed yet");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://github.com/clarifydoc/vscode/issues/new");
    expect(u.searchParams.get("body")).toBe(body);
  });

  it("names no path: only extensions and counts reach the body", () => {
    const { body } = issueReport(input);
    expect(body).not.toMatch(/src\/|Dockerfile/);
  });

  it("asks the questions of its kind, and caps a long body", () => {
    expect(issueReport({ ...input, kind: "bug" }).body).toMatch(/^\*\*What happened\*\*/);
    const many = { ...input, folders: Array.from({ length: 200 }, () => input.folders[0]!) };
    expect(issueReport(many).body.length).toBeLessThan(6100);
  });
});
