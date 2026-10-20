// Docked graph webview: draws what the extension posts (the active file's
// graph, in one or more views), outlines the node the cursor is in, and asks
// the extension to open a node's source on click.
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();
  const graph = document.getElementById("nb-graph");
  const title = document.getElementById("nb-title");
  const note = document.getElementById("nb-note");
  const buttons = document.getElementById("nb-views");
  const mermaid =
    (typeof window !== "undefined" && window.mermaid) ||
    (globalThis.__esbuild_esm_mermaid_nm && (globalThis.__esbuild_esm_mermaid_nm.mermaid.default || globalThis.__esbuild_esm_mermaid_nm.mermaid));
  if (!mermaid) {
    graph.textContent = "Mermaid failed to load. Rebuild the extension (npm run vendor).";
    return;
  }
  const dark = document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default", maxTextSize: 2000000, flowchart: { useMaxWidth: true, htmlLabels: false } });

  const NODE_ID = /-flowchart-(.+)-\d+$/;
  let views = [];
  let current = 0;
  let focus = null;

  function applyFocus() {
    for (const el of graph.querySelectorAll(".node")) {
      const m = NODE_ID.exec(el.id || "");
      el.classList.toggle("nb-focus", !!m && m[1] === focus);
    }
  }

  function render(index) {
    current = index;
    const view = views[index];
    if (!view) return;
    buttons.innerHTML = "";
    if (views.length > 1) {
      views.forEach((v, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cf-link" + (i === index ? " dg-current" : "");
        b.textContent = v.label;
        b.addEventListener("click", () => {
          render(i);
          vscode.postMessage({ type: "view", view: i });
        });
        buttons.appendChild(b);
      });
    }
    const linked = new Set(view.nodes || []);
    mermaid
      .render("nb-" + Date.now(), view.diagram)
      .then(({ svg }) => {
        graph.innerHTML = svg;
        for (const el of graph.querySelectorAll(".node")) {
          const m = NODE_ID.exec(el.id || "");
          if (!m || !linked.has(m[1])) continue;
          el.classList.add("cf-clickable");
          el.addEventListener("click", () => vscode.postMessage({ type: "open", node: m[1], view: current }));
        }
        applyFocus();
      })
      .catch((err) => {
        graph.textContent = "This graph did not render: " + (err && err.message ? err.message : String(err));
      });
  }

  window.addEventListener("message", (event) => {
    const m = event.data || {};
    if (m.type === "show") {
      title.textContent = m.title || "";
      title.title = m.title || "";
      note.textContent = m.note || "";
      views = m.views || [];
      render(Math.min(m.current || 0, Math.max(0, views.length - 1)));
    } else if (m.type === "focus") {
      focus = m.node || null;
      applyFocus();
    } else if (m.type === "empty") {
      title.textContent = m.title || "";
      note.textContent = m.note || "";
      views = [];
      buttons.innerHTML = "";
      graph.innerHTML = "";
    }
  });
  vscode.postMessage({ type: "ready" });
})();
