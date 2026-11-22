import { describe, expect, it } from "vitest";
import { prepareReportHtml, reportCsp } from "./reportHtml";

const CSP = /content="([^"]*)"/;
const nonceOf = (html: string) => /script-src 'nonce-([^']+)'/.exec(html)![1];

const page = '<!doctype html><html><head><meta charset="utf-8"><script type="module">boot()</script></head><body></body></html>';

describe("prepareReportHtml", () => {
  it("puts the CSP first in <head>, before any script", () => {
    const html = prepareReportHtml(page);
    const csp = html.indexOf(`content="${reportCsp(nonceOf(html))}"`);
    expect(csp).toBeGreaterThan(html.indexOf("<head>"));
    expect(csp).toBeLessThan(html.indexOf('<meta charset'));
    expect(html).not.toContain("__CLARIFYDOC_HASH__");
  });

  it("refuses everything the report does not use", () => {
    const csp = reportCsp("n");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/connect-src|unsafe-eval|blob:|https?:/);
  });

  it("allows scripts by nonce only, never 'unsafe-inline'", () => {
    const html = prepareReportHtml(page, "routes", { folder: "f" }, { files: [] });
    const scriptSrc = /script-src ([^;]*)/.exec(CSP.exec(html)![1])![1];
    expect(scriptSrc).toMatch(/^'nonce-[^']+'$/);
  });

  it("puts the nonce on every script, the page's and the injected one", () => {
    const withData = '<html><head><script type="module">var s="<script>x<\\/script>";boot()</script></head><body><script id="d" type="application/gzip-base64+json">AAA</script><SCRIPT>late()</SCRIPT></body></html>';
    const html = prepareReportHtml(withData, "routes", { folder: "f" }, { files: [] });
    const nonce = nonceOf(html);
    const tags = html.match(/<script[^>]*>/gi)!;
    // the bundle's own `<script>` string is text, not a tag: 1 injected + 3 page scripts + that string
    expect(tags.filter((t) => t.includes(`nonce="${nonce}"`))).toHaveLength(4);
    expect(html).toContain('var s="<script>x<\\/script>"');
    expect(html).toContain("__CLARIFYDOC_IMPACT__");
  });

  it("uses a fresh nonce on every load", () => {
    expect(nonceOf(prepareReportHtml(page))).not.toBe(nonceOf(prepareReportHtml(page)));
  });

  it("keeps a nonce a script already has", () => {
    const html = prepareReportHtml('<html><head><script nonce="mine">a()</script></head></html>');
    expect(html).toContain('<script nonce="mine">a()');
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

describe("prepareReportHtml with view state", () => {
  it("hands the viewer what to keep, before the deep link", () => {
    const html = prepareReportHtml(page, "routes", { folder: "file:///work/app" });
    expect(html).toContain('window.__CLARIFYDOC_VIEW_STATE__={"folder":"file:///work/app"};');
    expect(html.indexOf("__CLARIFYDOC_VIEW_STATE__")).toBeLessThan(html.indexOf("__CLARIFYDOC_HASH__"));
  });

  it("cannot be broken out of by the state either", () => {
    const html = prepareReportHtml(page, undefined, { folder: "</script><script>alert(1)//" });
    expect(html).not.toContain("</script><script>alert(1)");
  });

  it("hands the viewer the last run's impact, escaped like every literal", () => {
    const html = prepareReportHtml("<html><head></head><body></body></html>", undefined, undefined, { changedFiles: ["a</script>.ts"], routeCount: 1 });
    expect(html).toContain("window.__CLARIFYDOC_IMPACT__=");
    expect(html).not.toContain("a</script>");
    expect(prepareReportHtml("<html><head></head></html>")).not.toContain("__CLARIFYDOC_IMPACT__");
  });
});
