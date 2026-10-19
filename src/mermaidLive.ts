import { deflateSync } from "zlib";

/**
 * A mermaid.live link that opens `code` in its editor (VSCODE 9.3). The
 * diagram travels in the URL fragment, the `pako:` form the site reads:
 * zlib-deflated JSON of its editor state, base64url. A fragment is not sent
 * to the server, but the page is a third party's, so it opens only on an
 * explicit click — never written into a saved file.
 */
export function mermaidLiveUrl(code: string, dark = false): string {
  const state = { code, mermaid: JSON.stringify({ theme: dark ? "dark" : "default" }), autoSync: true, updateDiagram: true };
  const packed = deflateSync(Buffer.from(JSON.stringify(state), "utf8"), { level: 9 }).toString("base64url");
  return `https://mermaid.live/edit#pako:${packed}`;
}
