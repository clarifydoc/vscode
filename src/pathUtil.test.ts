import { describe, expect, it } from "vitest";
import * as path from "path";
import { relativeInside } from "./pathUtil";

describe("relativeInside", () => {
  const root = path.resolve("/work/app");

  it("returns the forward-slashed relative path of a file inside the root", () => {
    expect(relativeInside(root, path.join(root, "src", "a.ts"))).toBe("src/a.ts");
    expect(relativeInside(root, "src/a.ts")).toBe("src/a.ts");
  });

  it("refuses the root itself and anything outside it", () => {
    expect(relativeInside(root, root)).toBeUndefined();
    expect(relativeInside(root, path.resolve("/work/other/a.ts"))).toBeUndefined();
    expect(relativeInside(root, path.resolve("/etc/passwd"))).toBeUndefined();
    expect(relativeInside(root, "../app2/a.ts")).toBeUndefined();
  });

  it("decides on the resolved path, however it is spelled", () => {
    expect(relativeInside(root, "src/../../secret")).toBeUndefined();
    expect(relativeInside(root, "src/./x/../a.ts")).toBe("src/a.ts");
  });

  it("keeps names that only start with two dots", () => {
    expect(relativeInside(root, "..cache/a.ts")).toBe("..cache/a.ts");
  });
});
