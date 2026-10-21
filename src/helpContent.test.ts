import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import * as path from "path";
import { MENU_GROUPS, MORE_MENU, REPORT_SECTIONS, REPORT_TITLE_BUTTONS, SIDEBAR_BUTTONS, HELP_SECTIONS, renderHelpBody, runnableCommands, type HelpEntry } from "./helpContent";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8")) as {
  contributes: { commands: Array<{ command: string; title: string }>; menus: Record<string, Array<{ command?: string; when?: string; group?: string }>> };
};
const titles = new Map(pkg.contributes.commands.map((c) => [c.command, c.title]));
const menu = (id: string, when?: (w: string) => boolean) =>
  pkg.contributes.menus[id]!.filter((m) => m.command && (!when || when(m.when ?? ""))).map((m) => m.command!);
const commandsOf = (entries: HelpEntry[]) => entries.map((e) => e.command);
const group = (id: string) => MENU_GROUPS.find((g) => g.id === id)!.entries;
const summaryView = (w: string) => w.includes("view == clarifydoc.summary");

describe("help page", () => {
  it("names each command by the title package.json gives it", () => {
    for (const e of [...MENU_GROUPS.flatMap((g) => g.entries), ...SIDEBAR_BUTTONS, ...MORE_MENU, ...REPORT_TITLE_BUTTONS]) {
      expect(titles.get(e.command), e.command).toBe(e.label);
    }
  });

  it("covers every right-click entry", () => {
    expect(commandsOf(group("menu-editor")).sort()).toEqual(menu("clarifydoc.editorContext").sort());
    expect(commandsOf(group("menu-explorer")).sort()).toEqual(menu("explorer/context").sort());
    expect(new Set(commandsOf(group("menu-sidebar")))).toEqual(new Set(menu("view/item/context", summaryView)));
  });

  it("covers the Analysis view's buttons and its … menu", () => {
    const items = pkg.contributes.menus["view/title"]!.filter((m) => summaryView(m.when ?? ""));
    const buttons = items.filter((m) => m.group?.startsWith("navigation")).map((m) => m.command);
    const more = items.filter((m) => !m.group?.startsWith("navigation")).map((m) => m.command);
    expect(commandsOf(SIDEBAR_BUTTONS).sort()).toEqual(buttons.sort());
    expect(commandsOf(MORE_MENU).sort()).toEqual(more.sort());
  });

  it("covers the report's title bar", () => {
    expect(commandsOf(REPORT_TITLE_BUTTONS).sort()).toEqual(menu("editor/title", (w) => w.includes("clarifydoc.report")).sort());
  });

  it("runs only commands that exist", () => {
    const outside = new Set(["clarifydoc.openWalkthrough", "workbench.view.scm", "workbench.actions.view.problems"]);
    for (const command of runnableCommands().keys()) expect(titles.has(command) || outside.has(command), command).toBe(true);
  });

  it("renders every section, icon and anchor", () => {
    const html = renderHelpBody({ mac: false });
    for (const s of HELP_SECTIONS) expect(html).toContain(`id="${s}"`);
    for (const g of MENU_GROUPS) expect(html).toContain(`id="${g.id}"`);
    for (const s of REPORT_SECTIONS) expect(html).toContain(s.glyph);
    expect(html).toContain("Ctrl+Alt+D then A");
    expect(renderHelpBody({ mac: true })).toContain("⌘⌥D then A");
  });
});
