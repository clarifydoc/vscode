import { describe, expect, it, vi } from "vitest";
import { forgetNodeOnPath, nodeOnPath, nodeProbeKey, type Memory } from "./nodeProbe";

function memory(): Memory & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: <T>(k: string) => store.get(k) as T | undefined,
    update: async (k, v) => void (v === undefined ? store.delete(k) : store.set(k, v)),
  };
}
const key = nodeProbeKey("1.723.0", "", "");

describe("the remembered node probe", () => {
  it("spawns the probe once, and a second window start does not", async () => {
    const m = memory();
    const probe = vi.fn(async () => true);
    expect(await nodeOnPath(m, key, probe)).toBe(true);
    expect(await nodeOnPath(m, key, probe)).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("remembers that node is absent too", async () => {
    const m = memory();
    const probe = vi.fn(async () => false);
    await nodeOnPath(m, key, probe);
    expect(await nodeOnPath(m, key, probe)).toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a different analyzer version", nodeProbeKey("1.724.0", "", "")],
    ["another cliPath", nodeProbeKey("1.723.0", "/opt/cd/cli.js", "")],
    ["another nodePath", nodeProbeKey("1.723.0", "", "/usr/bin/node")],
  ])("asks again for %s", async (_why, other) => {
    const m = memory();
    const probe = vi.fn(async () => true);
    await nodeOnPath(m, key, probe);
    await nodeOnPath(m, other, probe);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("asks again after the answer is forgotten (resetCliResolution)", async () => {
    const m = memory();
    const probe = vi.fn(async () => true);
    await nodeOnPath(m, key, probe);
    await forgetNodeOnPath(m);
    await nodeOnPath(m, key, probe);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("probes every time without a memory", async () => {
    const probe = vi.fn(async () => true);
    await nodeOnPath(undefined, key, probe);
    await nodeOnPath(undefined, key, probe);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
