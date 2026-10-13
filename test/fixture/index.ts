import { runTestsIn } from "../suite/index";

/** The fixture suite: run inside a workspace that holds a fixture and its analysis. */
export function run(): Promise<void> {
  return runTestsIn(__dirname);
}
