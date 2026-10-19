import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { loadAnalysis } from "./analysisData";
import { callersOf, describeRoute, isUncalled, routeData, screensReaching } from "./crossTier";
import { makeNote, MAX_NOTES, parseNotes, renderNotesMarkdown, type Note } from "./notes";
import { outputBaseDir } from "./paths";
import { ExtensionState } from "./state";

/** Where a folder's notes live: beside its analysis, so they stay out of the source tree. */
export function notesFiles(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): { json: string; md: string } {
  const base = outputBaseDir(context, folder);
  return { json: path.join(base, "notes.json"), md: path.join(base, "notes.md") };
}

export async function readNotes(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): Promise<Note[]> {
  return parseNotes(await fs.readFile(notesFiles(context, folder).json, "utf8").catch(() => undefined));
}

/** One write at a time per folder: two quick notes must not lose each other. */
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
  queues.set(key, run.catch(() => undefined));
  return run;
}

/** What each note's subject is, across tiers: a file's routes with their screens and tables. */
async function contextFor(state: ExtensionState, folder: vscode.WorkspaceFolder): Promise<(subject: string) => string[]> {
  const a = await loadAnalysis(state.context, folder).catch(() => undefined);
  return (subject) => {
    if (!a) return [];
    if (subject.startsWith("file:")) {
      const facts = a.byFile.get(subject.slice(5));
      if (!facts) return ["not in the latest analysis"];
      return facts.routes
        .filter((r) => r.kind !== "frontend" && r.httpMethod)
        .slice(0, 8)
        .map((r) => {
          const callers = callersOf(facts, r);
          const line = describeRoute(callers.length, screensReaching(a.crossTier, callers), routeData(a.crossTier, r), isUncalled(a.crossTier, r));
          return `serves ${r.httpMethod} ${r.path}${line ? ` — ${line}` : ""}`;
        });
    }
    if (subject.startsWith("entity:")) {
      const defs = (a.store.entitiesByName.get(subject.slice(7)) ?? []) as Array<{ filePath?: unknown }>;
      const files = [...new Set(defs.map((d) => d.filePath).filter((f): f is string => typeof f === "string"))];
      return files.length ? [`defined in ${files.map((f) => `\`${f}\``).join(", ")}`] : [];
    }
    return [];
  };
}

async function writeNotes(state: ExtensionState, folder: vscode.WorkspaceFolder, notes: Note[]): Promise<void> {
  const { json, md } = notesFiles(state.context, folder);
  await fs.mkdir(path.dirname(json), { recursive: true });
  await fs.writeFile(json, JSON.stringify(notes, null, 2) + "\n", "utf8");
  await fs.writeFile(md, renderNotesMarkdown(folder.name, notes, await contextFor(state, folder)), "utf8");
}

/**
 * The report viewer's requests (`clarifydoc:request`): its notes, read and
 * written here. Everything it sends is checked — the page is built from the
 * analyzed repository's contents.
 */
export async function answerReportRequest(
  state: ExtensionState,
  folder: vscode.WorkspaceFolder,
  msg: { op?: unknown; subject?: unknown; text?: unknown; id?: unknown },
): Promise<{ result?: unknown; error?: string }> {
  const key = folder.uri.fsPath;
  if (msg.op === "notes.list") return { result: await readNotes(state.context, folder) };
  if (msg.op === "notes.add") {
    return serialized(key, async () => {
      const notes = await readNotes(state.context, folder);
      if (notes.length >= MAX_NOTES) return { error: `this map already has ${MAX_NOTES} notes` };
      const note = makeNote(msg.subject, msg.text, new Date(), randomUUID());
      if (typeof note === "string") return { error: note };
      await writeNotes(state, folder, [...notes, note]);
      return { result: note };
    });
  }
  if (msg.op === "notes.delete") {
    if (typeof msg.id !== "string") return { error: "which note?" };
    return serialized(key, async () => {
      const notes = await readNotes(state.context, folder);
      await writeNotes(state, folder, notes.filter((n) => n.id !== msg.id));
      return { result: null };
    });
  }
  return { error: `unknown request ${String(msg.op)}` };
}
