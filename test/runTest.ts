import * as path from "path";
import { runTests } from "@vscode/test-electron";

// Downloads a VS Code build (cached after first run) and launches the extension
// host with our compiled test suite. Run with `npm test`.
async function main() {
  // A terminal inside VS Code exports ELECTRON_RUN_AS_NODE=1; the downloaded
  // Code binary inherits it and starts as plain Node ("bad option: --no-sandbox").
  delete process.env.ELECTRON_RUN_AS_NODE;
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
    const extensionTestsPath = path.resolve(__dirname, "suite", "index");
    await runTests({ extensionDevelopmentPath, extensionTestsPath });
  } catch (err) {
    console.error("Failed to run tests:", err);
    process.exit(1);
  }
}

void main();
