import { describe, expect, it } from "vitest";
import { lineCommentFor, suppressionLine } from "./comments";

describe("suppression comments", () => {
  it("uses the language's line comment and keeps the indentation", () => {
    expect(suppressionLine("typescript", "    db.query(sql)")).toBe("    // clarifydoc-ignore-next-line\n");
    expect(suppressionLine("python", "\tcursor.execute(q)")).toBe("\t# clarifydoc-ignore-next-line\n");
    expect(suppressionLine("sql", "SELECT 1")).toBe("-- clarifydoc-ignore-next-line\n");
  });

  it("offers nothing for a language it has no line comment for", () => {
    expect(lineCommentFor("ocaml")).toBeUndefined();
    expect(suppressionLine("plaintext", "x")).toBeUndefined();
  });
});
