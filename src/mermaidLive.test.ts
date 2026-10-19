import { describe, expect, it } from "vitest";
import { inflateSync } from "zlib";
import { mermaidLiveUrl } from "./mermaidLive";

describe("mermaidLiveUrl", () => {
  it("packs the diagram into the fragment mermaid.live reads", () => {
    const url = mermaidLiveUrl("flowchart LR\n  a --> b", true);
    expect(url.startsWith("https://mermaid.live/edit#pako:")).toBe(true);
    const state = JSON.parse(inflateSync(Buffer.from(url.split("#pako:")[1]!, "base64url")).toString("utf8"));
    expect(state.code).toBe("flowchart LR\n  a --> b");
    expect(JSON.parse(state.mermaid).theme).toBe("dark");
  });

  it("keeps everything after the fragment marker — nothing reaches the server's query", () => {
    expect(new URL(mermaidLiveUrl("graph TD; a-->b")).search).toBe("");
  });
});
