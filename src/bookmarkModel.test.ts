import { describe, expect, it } from "vitest";
import { bookmarkLabel, withBookmark, withoutBookmark } from "./bookmarkModel";

describe("bookmarks", () => {
  it("names a view after its tab and what it focuses", () => {
    expect(bookmarkLabel("traces~api%2Froutes%2Forders.js")).toBe("Call Traces — orders.js");
    expect(bookmarkLabel("health/security")).toBe("Health — security");
    expect(bookmarkLabel("routes")).toBe("Routes");
    expect(bookmarkLabel("links/data-access~src%2Fdb.ts")).toBe("Architecture — db.ts");
    expect(bookmarkLabel("newtab")).toBe("newtab");
  });

  it("replaces a bookmark of the same name in the same folder only", () => {
    const a = { name: "x", folder: "/a", hash: "routes" };
    const list = withBookmark(withBookmark([a], { name: "x", folder: "/b", hash: "ui" }), { name: "x", folder: "/a", hash: "health" });
    expect(list).toEqual([{ name: "x", folder: "/b", hash: "ui" }, { name: "x", folder: "/a", hash: "health" }]);
    expect(withoutBookmark(list, { name: "x", folder: "/a" })).toEqual([{ name: "x", folder: "/b", hash: "ui" }]);
  });
});
