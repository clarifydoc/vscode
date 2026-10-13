import { describe, expect, it } from "vitest";
import { sourceGlobFrom } from "./sourceGlob";

describe("sourceGlobFrom", () => {
  it("globs every extension and named file", () => {
    expect(sourceGlobFrom({ analyzableExtensions: [".ts", ".vue"], namedFiles: ["jenkinsfile"] })).toBe(
      "{**/*.{ts,vue},**/{Jenkinsfile,jenkinsfile}}",
    );
  });

  it("is a plain extension glob without named files", () => {
    expect(sourceGlobFrom({ analyzableExtensions: [".py"] })).toBe("**/*.{py}");
  });

  it("refuses output it cannot use", () => {
    expect(sourceGlobFrom({})).toBeUndefined();
    expect(sourceGlobFrom({ analyzableExtensions: ["{bad}", 3] })).toBeUndefined();
  });
});
