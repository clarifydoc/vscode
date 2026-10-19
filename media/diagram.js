// Diagram webview: renders the Mermaid the extension or the engine produced
// and hands Save / Copy back to the extension, which owns the file dialogs.
// A diagram may come in several views of the same picture (functions, files):
// the buttons switch between them, and Save / Copy take the one on screen.
// A node the extension knows a source location for opens it on click.
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();
  const payloadEl = document.getElementById("dg-payload");
  const container = document.getElementById("dg-graph");
  if (!payloadEl || !container) return;
  const payload = JSON.parse(payloadEl.textContent || "{}");
  const views = payload.views || (payload.diagram ? [{ diagram: payload.diagram, nodes: [] }] : []);
  const mermaid =
    (typeof window !== "undefined" && window.mermaid) ||
    (globalThis.__esbuild_esm_mermaid_nm &&
      (globalThis.__esbuild_esm_mermaid_nm.mermaid.default || globalThis.__esbuild_esm_mermaid_nm.mermaid));
  if (!mermaid) {
    container.textContent = "Mermaid failed to load. Rebuild the extension (npm run vendor).";
    return;
  }
  const dark = document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default", maxTextSize: 2000000, flowchart: { useMaxWidth: false, htmlLabels: false } });

  /** Mermaid names a rendered node `<renderId>-flowchart-<nodeId>-<index>`. */
  const NODE_ID = /-flowchart-(.+)-\d+$/;
  let current = 0;
  let svgText = "";

  function render(index) {
    current = index;
    const view = views[index];
    if (!view) return;
    const linked = new Set(view.nodes || []);
    for (const b of document.querySelectorAll(".dg-view")) b.classList.toggle("dg-current", Number(b.dataset.view) === index);
    mermaid
      .render("dg-" + Date.now(), view.diagram)
      .then(({ svg }) => {
        svgText = svg;
        container.innerHTML = svg;
        for (const el of container.querySelectorAll(".node")) {
          const m = NODE_ID.exec(el.id || "");
          if (!m || !linked.has(m[1])) continue;
          el.classList.add("cf-clickable");
          el.addEventListener("click", () => vscode.postMessage({ type: "open", node: m[1], view: current }));
        }
      })
      .catch((err) => {
        container.textContent = "This diagram did not render: " + (err && err.message ? err.message : String(err));
      });
  }

  for (const b of document.querySelectorAll(".dg-view")) b.addEventListener("click", () => render(Number(b.dataset.view)));
  for (const [id, format] of [["dg-save-svg", "svg"], ["dg-save-mermaid", "mermaid"], ["dg-copy", "copy"]]) {
    const button = document.getElementById(id);
    if (button) button.addEventListener("click", () => vscode.postMessage({ type: format === "copy" ? "copy" : "save", format, svg: svgText, view: current }));
  }
  render(0);
})();
