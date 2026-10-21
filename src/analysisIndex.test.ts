import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { indexProject, indexProjectData, reviveIndexed } from "./analysisIndex";
import type { ResolvedAnalysis } from "./analysisData";

// The bundled analyzer (`npm run bundle`) and the monorepo's fixture outputs;
// absent in a bare checkout of the extension, where the test skips.
const reader = path.resolve(__dirname, "../clarifydoc/dist/index.js");
const fixtures = path.resolve(__dirname, "../../test-output");
const available = fs.existsSync(reader) && fs.existsSync(fixtures);

/** Everything but the closures, which are compared by what they answer. */
function data(a: ResolvedAnalysis) {
  const { types, isTest, history, ...rest } = a;
  return { ...rest, typeIds: [...types.byId.keys()], churn: history?.churn };
}

describe.skipIf(!available)("an index built on a worker thread", () => {
  // What summaryWorker.ts posts is structured-cloned on its way to the
  // extension host: it must survive that and revive to what indexProject gives.
  for (const fixture of ["sample-csharp-api", "sample-fullstack-cqrs", "sample-backend"]) {
    it(`revives to the same analysis after the clone (${fixture})`, async () => {
      const analyzer = await import(pathToFileURL(reader).href);
      const p = await analyzer.loadReportSummary(path.join(fixtures, fixture));
      // The fixtures carry no git history; give one file some, and a CODEOWNERS rule.
      p.fileChurn = [{ file: p.files[0], commits: 3, authors: ["Club Secretary"], busFactor: 1 }];
      p.codeOwners = { rules: [{ pattern: "*", owners: ["@league/referees"] }] };
      const here = indexProject(p, analyzer.buildIndex, analyzer);
      const there = reviveIndexed(structuredClone(indexProjectData(p, analyzer.buildIndex)), analyzer);

      expect(here.types.byId.size).toBeGreaterThan(0);
      expect(here.history?.churn.size).toBe(1);
      expect(data(there)).toEqual(data(here));
      for (const id of here.types.byId.keys()) {
        expect(there.types.supertypes(id)).toEqual(here.types.supertypes(id));
        expect(there.types.subtypes(id)).toEqual(here.types.subtypes(id));
      }
      for (const file of here.files) {
        expect(there.isTest?.(file)).toBe(here.isTest?.(file));
        expect(there.history?.ownersOf?.(file)).toEqual(here.history?.ownersOf?.(file));
      }
    });
  }
});
