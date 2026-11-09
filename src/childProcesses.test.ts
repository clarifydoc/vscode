import { afterAll, afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { killAllChildren, killChildrenForFolder, killChildrenWritingTo, runClarifyDoc, type ResolvedCli } from "./cli";

const cli = { command: process.execPath, baseArgs: ["-e", "setTimeout(() => {}, 60000)", "--"] } as unknown as ResolvedCli;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "clarifydoc-children-"));
const league = path.join(root, "league-app");
const garage = path.join(root, "garage-app");
fs.mkdirSync(league);
fs.mkdirSync(garage);

const start = (cwd: string, args: string[] = []) => {
  const run = runClarifyDoc(cli, args, { cwd });
  return { run, done: run.then((r) => r.code, () => "rejected") };
};
const settled = (p: Promise<unknown>) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), 150))]);

afterEach(() => killAllChildren());
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("stopping the children of one folder", () => {
  it("kills only the removed folder's analysis", async () => {
    const a = start(league);
    const b = start(garage);
    await new Promise((r) => setTimeout(r, 100));
    expect(killChildrenForFolder(league)).toBe(1);
    expect(await a.done).not.toBe(0);
    expect(await settled(b.done)).toBe(false); // the other folder's run goes on
  });

  it("kills a run writing to the old output location, not one writing elsewhere", async () => {
    const oldOut = path.join(league, ".clarifydoc");
    const scratch = path.join(os.tmpdir(), "compare", "league");
    const a = start(league, ["-o", oldOut]);
    const b = start(league, ["-o", scratch]);
    await new Promise((r) => setTimeout(r, 100));
    expect(killChildrenWritingTo(league, oldOut)).toBe(1);
    expect(await a.done).not.toBe(0);
    expect(await settled(b.done)).toBe(false);
  });
});
