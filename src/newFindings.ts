/**
 * Which security findings are new: those the latest analysis the extension
 * loaded has and the analysis before it did not. A finding is identified by
 * file, category and message — not its line — so a finding that only moved
 * down a file is not new. The first analysis ever seen is the baseline: nothing
 * in it is new. A reload of the same analysis changes nothing.
 */

export interface FindingLike {
  filePath: string;
  category: string;
  message: string;
}

/** The part of `vscode.Memento` this needs. */
export interface Store {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

interface Seen {
  /** The finding keys of the analysis before the current one; absent for a baseline. */
  prev?: string[];
  cur: string[];
}

export const findingKey = (s: FindingLike): string => `${s.filePath}\u0000${s.category}\u0000${s.message}`;

export class FindingTracker {
  private readonly seen = new Map<string, Seen>();
  private readonly prevSets = new WeakMap<Seen, Set<string>>();

  constructor(private readonly store?: Store) {}

  private read(folder: string): Seen | undefined {
    return this.seen.get(folder) ?? this.store?.get<Seen>(`clarifydoc.findings:${folder}`);
  }

  /** Record the findings of the analysis just loaded for a folder. */
  update(folder: string, findings: FindingLike[]): void {
    const keys = [...new Set(findings.map(findingKey))].sort();
    const before = this.read(folder);
    let next: Seen;
    if (!before) next = { cur: keys };
    else if (before.cur.join("\n") === keys.join("\n")) next = before;
    else next = { prev: before.cur, cur: keys };
    this.seen.set(folder, next);
    if (next !== before) void this.store?.update(`clarifydoc.findings:${folder}`, next);
  }

  isNew(folder: string, finding: FindingLike): boolean {
    const s = this.read(folder);
    if (!s?.prev) return false;
    let set = this.prevSets.get(s);
    if (!set) this.prevSets.set(s, (set = new Set(s.prev)));
    return !set.has(findingKey(finding));
  }

  /** How many of these findings are new. */
  count(folder: string, findings: FindingLike[]): number {
    return findings.filter((f) => this.isNew(folder, f)).length;
  }
}
