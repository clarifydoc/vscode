/**
 * The slice of the `vscode` API the unit tests reach, implemented just far
 * enough to construct values and read them back. Add to it as tests need more;
 * anything that would talk to a running editor does not belong here.
 */
import * as path from "path";

export class Position {
  constructor(readonly line: number, readonly character: number) {}
}

export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
    this.start = new Position(startLine, startCharacter);
    this.end = new Position(endLine, endCharacter);
  }
}

export class Uri {
  private constructor(readonly scheme: string, readonly fsPath: string) {}
  static file(p: string): Uri {
    return new Uri("file", path.resolve(p));
  }
  static parse(value: string): Uri {
    return value.startsWith("file://") ? Uri.file(decodeURIComponent(value.slice("file://".length))) : new Uri("unknown", value);
  }
  get path(): string {
    return this.fsPath.split(path.sep).join("/");
  }
  toString(): string {
    return `file://${encodeURI(this.path)}`;
  }
}

export class Location {
  constructor(readonly uri: Uri, readonly range: Range | Position) {}
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Diagnostic {
  source?: string;
  code?: string | number | { value: string | number; target: Uri };
  constructor(readonly range: Range, readonly message: string, readonly severity = DiagnosticSeverity.Error) {}
}

export class MarkdownString {
  value = "";
  isTrusted?: boolean | { enabledCommands: readonly string[] };
  supportThemeIcons?: boolean;
  appendMarkdown(v: string): this {
    this.value += v;
    return this;
  }
}

export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];
  readonly event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => (this.listeners = this.listeners.filter((l) => l !== listener)) };
  };
  fire(e: T): void {
    for (const l of this.listeners) l(e);
  }
  dispose(): void {
    this.listeners = [];
  }
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class ThemeIcon {
  constructor(readonly id: string, readonly color?: ThemeColor) {}
}

export class TreeItem {
  description?: string | boolean;
  tooltip?: string | MarkdownString;
  iconPath?: ThemeIcon;
  resourceUri?: Uri;
  command?: { command: string; title: string; arguments?: unknown[] };
  constructor(readonly label: string, public collapsibleState = TreeItemCollapsibleState.None) {}
}
