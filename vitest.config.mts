import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

// Unit tests run in plain Node, without a VS Code instance. Most of what they
// cover lives in vscode-free modules; the rest gets a minimal stand-in for the
// `vscode` module (test/mocks/vscode.ts). The extension-host suite under
// test/suite still runs through @vscode/test-electron (`npm test`).
export default defineConfig({
  resolve: {
    alias: { vscode: fileURLToPath(new URL("./test/mocks/vscode.ts", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // The bundled analyzer is shipped JavaScript; Node loads it as-is.
    server: { deps: { external: [/\/clarifydoc\/dist\//] } },
  },
});
