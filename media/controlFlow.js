// Control-flow webview. Renders the Mermaid the engine generated, then wires
// the diagram to the editor in both directions.
//
// The engine emits the flowchart with its category classes (`cfDecision`,
// `cfLoop`, …) but without a colour table, so the palette below can follow the
// editor's theme instead of fighting it.
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const payloadEl = document.getElementById("cf-payload");
  const container = document.getElementById("cf-graph");
  if (!payloadEl || !container) return;

  const payload = JSON.parse(payloadEl.textContent || "{}");
  const nodes = payload.nodes || [];
  /** CFG node id → its source span, for both directions of navigation. */
  const spans = new Map(nodes.map((n) => [n.id, n]));

  const mermaid =
    (typeof window !== "undefined" && window.mermaid) ||
    (globalThis.__esbuild_esm_mermaid_nm &&
      (globalThis.__esbuild_esm_mermaid_nm.mermaid.default ||
        globalThis.__esbuild_esm_mermaid_nm.mermaid));

  if (!mermaid) {
    container.textContent = "Mermaid failed to load. Rebuild the extension (npm run vendor).";
    return;
  }

  const dark = document.body.classList.contains("vscode-dark") ||
    document.body.classList.contains("vscode-high-contrast");

  mermaid.initialize({
    startOnLoad: false,
    // `strict` keeps Mermaid from honouring any markup that reached a label,
    // which matters because every label here is arbitrary source text.
    securityLevel: "strict",
    theme: dark ? "dark" : "default",
    flowchart: { useMaxWidth: false, htmlLabels: false, curve: "basis" },
  });

  /**
   * Mermaid names each rendered node `<renderId>-flowchart-<nodeId>-<index>`.
   * That is how a click on an SVG shape finds its way back to a source line.
   */
  const NODE_ID = /-flowchart-(n\d+)-\d+$/;

  function cfgIdOf(el) {
    const match = NODE_ID.exec(el.id || "");
    return match ? match[1] : null;
  }

  let current = null;

  function highlight(id) {
    if (current === id) return;
    for (const el of container.querySelectorAll(".node.cf-current")) {
      el.classList.remove("cf-current");
    }
    current = id;
    if (!id) return;
    for (const el of container.querySelectorAll(".node")) {
      if (cfgIdOf(el) !== id) continue;
      el.classList.add("cf-current");
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      break;
    }
  }

  mermaid
    .render("cfg", payload.diagram)
    .then(({ svg }) => {
      container.innerHTML = svg;

      for (const el of container.querySelectorAll(".node")) {
        const id = cfgIdOf(el);
        if (!id || !spans.has(id)) continue;
        el.classList.add("cf-clickable");
        el.addEventListener("click", () => {
          vscode.postMessage({ type: "reveal", line: spans.get(id).line });
        });
      }
    })
    .catch((error) => {
      // Worth surfacing rather than swallowing: a Mermaid parse failure means
      // the generator produced something invalid, which is a bug in the engine
      // and not something the reader can do anything about silently.
      container.textContent = "Could not draw the diagram: " + (error && error.message);
    });

  // The flame CodeLens used to open the Complexity tab; it now opens this view
  // instead, so the tab it replaced stays one click away.
  const reportButton = document.getElementById("cf-report");
  if (reportButton) {
    reportButton.addEventListener("click", () => {
      vscode.postMessage({ type: "openComplexityReport" });
    });
  }

  // Save: the host writes the file through its own save dialog.
  const saveSvg = document.getElementById("cf-save-svg");
  if (saveSvg) {
    saveSvg.addEventListener("click", () => {
      const svg = container.querySelector("svg");
      if (!svg) return;
      const copy = svg.cloneNode(true);
      copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      vscode.postMessage({ type: "save", format: "svg", svg: copy.outerHTML });
    });
  }
  const saveMermaid = document.getElementById("cf-save-mermaid");
  if (saveMermaid) {
    saveMermaid.addEventListener("click", () => vscode.postMessage({ type: "save", format: "mermaid" }));
  }

  // Editor → diagram: highlight the innermost node covering the cursor line.
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.type !== "cursor") return;

    let best = null;
    for (const node of nodes) {
      if (message.line < node.line || message.line > node.endLine) continue;
      // Innermost wins: a `return` inside an `if` should highlight the return.
      if (!best || node.endLine - node.line <= best.endLine - best.line) best = node;
    }
    highlight(best ? best.id : null);
  });
})();
