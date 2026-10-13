import * as path from "path";
import * as fs from "fs";
import Mocha from "mocha";

/** Discover compiled *.test.js files under this directory (recursively). */
function findTests(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTests(full));
    else if (entry.name.endsWith(".test.js")) out.push(full);
  }
  return out;
}

/** Run every compiled test under `testsRoot` with Mocha. */
export function runTestsIn(testsRoot: string): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 120000 });
  for (const file of findTests(testsRoot)) mocha.addFile(file);

  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures) => (failures > 0 ? reject(new Error(`${failures} test(s) failed.`)) : resolve()));
    } catch (err) {
      reject(err as Error);
    }
  });
}

export function run(): Promise<void> {
  return runTestsIn(__dirname);
}
