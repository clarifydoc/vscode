import { describe, expect, it } from "vitest";
import { sourceGlobFrom } from "./sourceGlob";

describe("sourceGlobFrom", () => {
  it("globs every extension and named file", () => {
    // Never nested braces: VS Code's watcher delivers nothing for them.
    expect(sourceGlobFrom({ analyzableExtensions: [".ts", ".vue"], namedFiles: ["jenkinsfile"] })).toEqual([
      "**/*.{ts,vue}",
      "**/{Jenkinsfile,jenkinsfile}",
    ]);
  });

  it("is a plain extension glob without named files", () => {
    expect(sourceGlobFrom({ analyzableExtensions: [".py"] })).toEqual(["**/*.{py}"]);
  });

  it("refuses output it cannot use", () => {
    expect(sourceGlobFrom({})).toBeUndefined();
    expect(sourceGlobFrom({ analyzableExtensions: ["{bad}", 3] })).toBeUndefined();
  });
});
