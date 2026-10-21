import { runTestsIn } from "../suite/index";

/** The startup gate on a real project: run inside that project's own folder (see runTest.ts). */
export function run(): Promise<void> {
  return runTestsIn(__dirname);
}
