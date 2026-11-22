import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import * as path from "path";

describe("the Changed Elements contribution", () => {
  it("declares the view the code creates", () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8")) as { contributes: { views: Record<string, Array<{ id: string; name: string }>> } };
    const view = pkg.contributes.views.scm!.find((v) => v.id === "clarifydoc.changedElements");
    expect(view?.name).toBeTruthy();
  });
});
