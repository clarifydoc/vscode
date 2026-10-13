import { describe, expect, it } from "vitest";
import { prepareReportHtml, REPORT_CSP } from "./reportHtml";

const page = '<!doctype html><html><head><meta charset="utf-8"><script type="module">boot()</script></head><body></body></html>';

describe("prepareReportHtml", () => {
  it("puts the CSP first in <head>, before any script", () => {
    const html = prepareReportHtml(page);
    const csp = html.indexOf(`content="${REPORT_CSP}"`);
    expect(csp).toBeGreaterThan(html.indexOf("<head>"));
    expect(csp).toBeLessThan(html.indexOf('<meta charset'));
    expect(html).not.toContain("__CLARIFYDOC_HASH__");
  });

  it("refuses everything the report does not use", () => {
    expect(REPORT_CSP).toContain("default-src 'none'");
    expect(REPORT_CSP).not.toMatch(/connect-src|unsafe-eval|blob:|https?:/);
  });

  it("injects the deep link after the CSP", () => {
    const html = prepareReportHtml(page, "traces~src/a.ts");
    expect(html).toContain('window.__CLARIFYDOC_HASH__="#traces~src/a.ts"');
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("__CLARIFYDOC_HASH__"));
  });

  it("cannot be broken out of by the hash", () => {
    const html = prepareReportHtml(page, "ui~</script><script>alert(1)</script>");
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
  });

  it("prepends when there is no <head>", () => {
    expect(prepareReportHtml("<p>x</p>").startsWith("<meta http-equiv")).toBe(true);
  });
});
