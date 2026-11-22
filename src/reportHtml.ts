import { randomBytes } from "node:crypto";

/**
 * What the report webview may do. The report is one self-contained file: an
 * inline module script (each inline script runs on a per-load nonce, no `'unsafe-inline'`), inline styles and a `data:` favicon, with its payload
 * in a non-executable `<script type="application/gzip-base64+json">`. It uses
 * no eval, no workers, no `blob:` URLs and fetches nothing — so everything
 * else is refused, and a report built from a hostile repository cannot reach
 * the network or load anything from disk.
 */
export function reportCsp(nonce: string): string {
  return `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:`;
}

/**
 * Give every `<script>` of the page a nonce. A script's body never holds a
 * literal `</script`, so after an opening tag the scan jumps to the next
 * closing one: a `<script>` written inside the viewer bundle's strings is
 * never touched. A script that already has a nonce keeps its own.
 */
function nonceScripts(html: string, nonce: string): string {
  let out = "";
  let at = 0;
  const open = /<script(?=[\s>/])/gi;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const end = html.indexOf(">", m.index);
    if (end < 0) break;
    const tag = html.slice(m.index, end + 1);
    out += html.slice(at, m.index) + (/\snonce\s*=/i.test(tag) ? tag : `<script nonce="${nonce}"${tag.slice(7)}`);
    at = end + 1;
    const closeAt = html.toLowerCase().indexOf("</script", at);
    open.lastIndex = closeAt < 0 ? html.length : closeAt;
  }
  return out + html.slice(at);
}

/**
 * The report HTML as the webview shows it: the CSP first in `<head>`, then —
 * when given — what the viewer should keep in its webview state (which folder
 * it shows, so a reload can restore it) and an initial deep-link
 * (`<tab>~<file>`). The deep link is a
 * classic `<head>` script that runs during parse, before the viewer's module
 * mounts, and sets `window.__CLARIFYDOC_HASH__`, which the viewer reads first.
 * VS Code webviews can block fragment navigation, so `location.hash` alone is
 * unreliable there; the global always survives (the hash is set too).
 */
export function prepareReportHtml(html: string, hash?: string, viewState?: Record<string, string>, impact?: unknown, overlay?: unknown): string {
  // JSON is a JS literal; `<` is escaped so a value cannot close the tag.
  const literal = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  const nonce = randomBytes(16).toString("base64");
  let head = `<meta http-equiv="Content-Security-Policy" content="${reportCsp(nonce)}">`;
  const script: string[] = [];
  if (viewState) script.push(`window.__CLARIFYDOC_VIEW_STATE__=${literal(viewState)};`);
  // The last incremental run's impact (impact-latest.json): the viewer marks what it changed and reached.
  if (impact) script.push(`window.__CLARIFYDOC_IMPACT__=${literal(impact)};`);
  // What a change did to elements (changed / added / removed / reached): the viewer marks them on every surface.
  if (overlay) script.push(`window.__CLARIFYDOC_OVERLAY__=${literal(overlay)};`);
  if (hash) {
    const h = literal("#" + hash);
    script.push(`window.__CLARIFYDOC_HASH__=${h};try{location.hash=${h}}catch(e){}`);
  }
  if (script.length) head += `<script>${script.join("")}</script>`;
  // The nonce goes on the page's own scripts and the injected one alike; the CSP meta carries no script.
  const page = nonceScripts(html, nonce);
  if (/<head[^>]*>/i.test(page)) return page.replace(/<head[^>]*>/i, (m) => m + nonceScripts(head, nonce));
  return nonceScripts(head, nonce) + page;
}
