import { describe, expect, it } from "vitest";
import { changedElementNodes, mergeOverlays, overlayFromImpact, overlayFromSurface, overlayMessage, splitRoute } from "./changeOverlay";
import { ChangeOverlayHub } from "./changeOverlayHub";
import { prepareReportHtml } from "./reportHtml";

const surface = {
  changes: [
    { kind: "route-removed", breaking: true, route: "DELETE /api/v2/clubs/{id}", file: "src/clubs.ts", line: 12, reasons: ["route removed"] },
    { kind: "route-added", breaking: false, route: "GET /api/v2/players", file: "src/players.ts", line: 4, reasons: ["new route"] },
    { kind: "guard-lost", breaking: false, risky: true, route: "PUT /api/v2/clubs/{id}", file: "src/clubs.ts", line: 30, reasons: ["guard lost"] },
  ],
};

describe("splitRoute", () => {
  it("reads the verb off a route label", () => {
    expect(splitRoute("GET /api/v2/clubs")).toEqual({ method: "GET", path: "/api/v2/clubs" });
    expect(splitRoute("* /health")).toEqual({ method: null, path: "/health" });
    expect(splitRoute("/clubs")).toEqual({ method: null, path: "/clubs" });
  });
});

describe("overlayFromSurface", () => {
  const o = overlayFromSurface(surface, "main");

  it("carries added and removed routes, and marks any other change as changed", () => {
    const route = (id: string) => o.entries.find((e) => e.of === "route" && e.id === id)!;
    expect(route("/api/v2/clubs/{id}").kind).toBe("removed");
    expect(route("/api/v2/players")).toMatchObject({ kind: "added", method: "GET" });
    expect(o.entries.filter((e) => e.of === "route" && e.id === "/api/v2/clubs/{id}")).toHaveLength(2);
    expect(o.label).toBe("API surface vs main");
  });

  it("marks the file of a live route changed, never the file of a removed one", () => {
    const files = o.entries.filter((e) => e.of === "file").map((e) => e.id);
    expect(files).toContain("src/players.ts");
    expect(files).toContain("src/clubs.ts"); // the guard change in the same file keeps it changed
    expect(overlayFromSurface({ changes: [surface.changes[0]!] }, "main").entries.some((e) => e.of === "file")).toBe(false);
  });
});

describe("added files and cycle files", () => {
  const base = { baseLabel: "HEAD", screens: [], routes: [], entities: [] };

  it("marks addedFiles added (once, even when also changed); unknownFiles stay unmarked; an older CLI changes nothing", () => {
    const o = overlayFromImpact({ ...base, changedFiles: ["src/clubs.ts", "src/garage.ts"], addedFiles: ["src/garage.ts", "src/cars.ts"], unknownFiles: ["notes.md"] } as never);
    expect(o.entries.map((e) => `${e.kind}:${e.id}`).sort()).toEqual(["added:src/cars.ts", "added:src/garage.ts", "changed:src/clubs.ts"]);
    const old = overlayFromImpact({ ...base, changedFiles: ["src/garage.ts"] });
    expect(old.entries.map((e) => e.kind)).toEqual(["changed"]);
  });

  it("marks the files of introduced and grown cycles changed, with a note; no cycles, no entries", () => {
    const o = overlayFromSurface(
      { changes: [], cycles: { introduced: [["src/club.ts", "src/player.ts"]], grown: [{ files: ["src/car.ts", "src/garage.ts", "src/club.ts"], added: ["src/garage.ts"] }] } },
      "main",
    );
    const by = Object.fromEntries(o.entries.map((e) => [e.id, e]));
    expect(Object.keys(by).sort()).toEqual(["src/car.ts", "src/club.ts", "src/garage.ts", "src/player.ts"]);
    expect(by["src/player.ts"]).toMatchObject({ kind: "changed", of: "file", note: "in a new import cycle" });
    expect(by["src/garage.ts"]!.note).toBe("joined an import cycle");
    expect(by["src/car.ts"]!.note).toBe("in a grown import cycle");
    expect(overlayFromSurface({ changes: [] }, "main").entries).toEqual([]);
  });
});

describe("overlayFromImpact and merge", () => {
  const impact = overlayFromImpact({
    baseLabel: "HEAD",
    changedFiles: ["src/clubs.ts"],
    screens: [{ name: "ClubPage", file: "web/ClubPage.tsx", route: "/clubs" }],
    routes: [{ method: "GET", path: "/api/v2/clubs", file: "src/clubs.ts", line: 3 }],
    entities: ["Club"],
  });

  it("states changed files and what they reach — no added without addedFiles", () => {
    expect(impact.entries.map((e) => e.kind)).toEqual(["changed", "reached", "reached", "reached"]);
    expect(impact.label).toBe("Uncommitted changes");
  });

  it("keeps the strongest kind where two sources name one element", () => {
    const merged = mergeOverlays([impact, overlayFromSurface({ changes: [{ kind: "route-removed", breaking: true, route: "GET /api/v2/clubs", reasons: [] }] }, "main")])!;
    const clubs = merged.entries.filter((e) => e.of === "route" && e.id === "/api/v2/clubs");
    expect(clubs).toHaveLength(1);
    expect(clubs[0]!.kind).toBe("removed");
    expect(mergeOverlays([null, { label: "x", entries: [] }])).toBeNull();
  });
});

describe("changedElementNodes", () => {
  it("groups by kind, strongest first, with the glyph leading every label", () => {
    const nodes = changedElementNodes(overlayFromSurface(surface, "main"));
    expect(nodes.map((n) => n.label)).toEqual(["− Removed", "+ Added", "~ Changed"]);
    expect(nodes[0]!.children![0]!.label).toBe("− DELETE /api/v2/clubs/{id}");
    expect(nodes[1]!.children![0]).toMatchObject({ label: "+ GET /api/v2/players", file: "src/players.ts", line: 4 });
  });

  it("says so when there is nothing", () => {
    expect(changedElementNodes(null)).toHaveLength(1);
  });
});

describe("the hub", () => {
  it("merges the working tree and the comparison, and tells listeners only about real changes", () => {
    const hub = new ChangeOverlayHub();
    const seen: string[] = [];
    hub.onDidChange((k) => seen.push(k));
    const impact = overlayFromImpact({ baseLabel: "HEAD", changedFiles: ["a.ts"], screens: [], routes: [], entities: [] });
    hub.setImpact("/work/club", impact);
    hub.setImpact("/work/club", impact);
    hub.setSurface("/work/club", overlayFromSurface(surface, "main"));
    expect(seen).toEqual(["/work/club", "/work/club"]);
    expect(hub.get("/work/club")!.entries.some((e) => e.kind === "removed")).toBe(true);
    hub.setSurface("/work/club", null);
    expect(hub.get("/work/club")!.entries.some((e) => e.kind === "removed")).toBe(false);
    expect(hub.get("/work/other")).toBeNull();
  });
});

describe("what reaches the report", () => {
  it("is the clarifydoc:overlay message, null clearing it", () => {
    expect(overlayMessage(null)).toEqual({ type: "clarifydoc:overlay", overlay: null });
    expect(overlayMessage({ label: "x", entries: [] }).type).toBe("clarifydoc:overlay");
  });

  it("is injected at load, escaped like every literal", () => {
    const html = prepareReportHtml("<html><head></head><body></body></html>", undefined, undefined, undefined, { label: "</script>", entries: [] });
    expect(html).toContain("window.__CLARIFYDOC_OVERLAY__=");
    expect(html).not.toContain("</script>\"");
    expect(prepareReportHtml("<html><head></head></html>")).not.toContain("__CLARIFYDOC_OVERLAY__");
  });
});
