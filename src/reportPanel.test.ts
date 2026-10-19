import { describe, expect, it } from "vitest";
import { embeddedPayload, followHash } from "./reportPanel";

describe("embeddedPayload", () => {
  it("reads the gzip+base64 payload, whatever the attribute order", () => {
    expect(embeddedPayload('<head></head><script type="application/gzip-base64+json" id="clarifydoc-data">\n H4sIAAAA \n</script>')).toEqual({ data: "H4sIAAAA", json: false });
    expect(embeddedPayload("<script id='clarifydoc-data' type='application/json'>{\"a\":1}</script>")).toEqual({ data: '{"a":1}', json: true });
  });

  it("has nothing for the bare template or a page without one", () => {
    expect(embeddedPayload('<script id="clarifydoc-data" type="application/gzip-base64+json">__CLARIFYDOC_DATA__</script>')).toBeUndefined();
    expect(embeddedPayload("<html></html>")).toBeUndefined();
  });
});

describe("followHash", () => {
  it("moves a file-focused tab to the new file", () => {
    expect(followHash("traces~src%2Fa.ts", "src/b.ts")).toBe("traces~src%2Fb.ts");
    expect(followHash("ui", "src/App.tsx")).toBe("ui~src%2FApp.tsx");
    expect(followHash("blast~x", "y")).toBe("blast~y");
  });

  it("leaves every other tab, and the same file, alone", () => {
    expect(followHash("routes", "src/b.ts")).toBeUndefined();
    expect(followHash("health/security", "src/b.ts")).toBeUndefined();
    expect(followHash(undefined, "src/b.ts")).toBeUndefined();
    expect(followHash("traces~src%2Fb.ts", "src/b.ts")).toBeUndefined();
    expect(followHash("uiextra", "src/b.ts")).toBeUndefined();
  });
});
