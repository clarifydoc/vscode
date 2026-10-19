// Architecture-diagram webview: renders the Mermaid the engine exported and
// hands Save / Copy back to the extension, which owns the file dialogs.
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();
  const payloadEl = document.getElementById("dg-payload");
  const container = document.getElementById("dg-graph");
  if (!payloadEl || !container) return;
  const { diagram } = JSON.parse(payloadEl.textContent || "{}");
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
  let svgText = "";
  mermaid
    .render("dg-" + Date.now(), diagram)
    .then(({ svg }) => {
      svgText = svg;
      container.innerHTML = svg;
    })
    .catch((err) => {
      container.textContent = "This diagram did not render: " + (err && err.message ? err.message : String(err));
    });
  for (const [id, format] of [["dg-save-svg", "svg"], ["dg-save-mermaid", "mermaid"], ["dg-copy", "copy"]]) {
    const button = document.getElementById(id);
    if (button) button.addEventListener("click", () => vscode.postMessage({ type: format === "copy" ? "copy" : "save", format, svg: svgText }));
  }
})();
