/**
 * What the report webview may do. The report is one self-contained file: an
 * inline module script, inline styles and a `data:` favicon, with its payload
 * in a non-executable `<script type="application/gzip-base64+json">`. It uses
 * no eval, no workers, no `blob:` URLs and fetches nothing — so everything
 * else is refused, and a report built from a hostile repository cannot reach
 * the network or load anything from disk.
 */
export const REPORT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:";

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
export function prepareReportHtml(html: string, hash?: string, viewState?: Record<string, string>): string {
  // JSON is a JS literal; `<` is escaped so a value cannot close the tag.
  const literal = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  let head = `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`;
  const script: string[] = [];
  if (viewState) script.push(`window.__CLARIFYDOC_VIEW_STATE__=${literal(viewState)};`);
  if (hash) {
    const h = literal("#" + hash);
    script.push(`window.__CLARIFYDOC_HASH__=${h};try{location.hash=${h}}catch(e){}`);
  }
  if (script.length) head += `<script>${script.join("")}</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + head);
  return head + html;
}
