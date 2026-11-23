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
  const modeBar = document.getElementById("nb-modes");
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
  let modes = [];
  let mode = "symbol";
  let views = [];
  let current = 0;
  let focus = null;

  function applyFocus() {
    for (const el of graph.querySelectorAll(".node")) {
      const m = NODE_ID.exec(el.id || "");
      el.classList.toggle("nb-focus", !!m && m[1] === focus);
    }
  }

  function selectMode(id, tell) {
    mode = id;
    const m = modes.find((x) => x.id === id) || modes[0];
    views = m ? m.views : [];
    note.textContent = m ? m.note || "" : "";
    drawModes();
    if (tell) vscode.postMessage({ type: "mode", mode: id });
    if (views.length) render(0);
    else {
      buttons.innerHTML = "";
      graph.innerHTML = "";
    }
  }

  // A tablist: one stop in the tab order, arrow keys move between modes.
  function drawModes() {
    modeBar.innerHTML = "";
    modes.forEach((m) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.className = "cf-link" + (m.id === mode ? " dg-current" : "");
      b.setAttribute("aria-selected", String(m.id === mode));
      b.tabIndex = m.id === mode ? 0 : -1;
      b.textContent = m.label;
      b.addEventListener("click", () => selectMode(m.id, true));
      b.addEventListener("keydown", (e) => {
        const i = modes.findIndex((x) => x.id === m.id);
        const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? modes.length - 1 : -1;
        if (to < 0) return;
        e.preventDefault();
        selectMode(modes[(to + modes.length) % modes.length].id, true);
        const sel = modeBar.querySelector('[aria-selected="true"]');
        if (sel) sel.focus();
      });
      modeBar.appendChild(b);
    });
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
          vscode.postMessage({ type: "view", view: i, mode });
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
          el.addEventListener("click", () => vscode.postMessage({ type: "open", node: m[1], view: current, mode }));
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
      modes = m.modes || [];
      mode = m.mode || "symbol";
      const cur = modes.find((x) => x.id === mode) || modes[0];
      views = cur ? cur.views : [];
      note.textContent = cur ? cur.note || "" : "";
      drawModes();
      if (views.length) render(Math.min(m.current || 0, views.length - 1));
      else {
        buttons.innerHTML = "";
        graph.innerHTML = "";
      }
    } else if (m.type === "focus") {
      focus = m.node || null;
      applyFocus();
    } else if (m.type === "empty") {
      title.textContent = m.title || "";
      note.textContent = m.note || "";
      views = [];
      modes = [];
      modeBar.innerHTML = "";
      buttons.innerHTML = "";
      graph.innerHTML = "";
    }
  });
  vscode.postMessage({ type: "ready" });
})();
