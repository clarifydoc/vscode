/**
 * Escape text from an analysis — symbol names, finding messages, route paths,
 * all of which come from the analyzed repository — for interpolation into a
 * MarkdownString. Every ASCII punctuation mark Markdown could read as syntax is
 * backslash-escaped (CommonMark allows that for any of them), which also turns
 * `$(icon)` into literal text when theme icons are on, and `[x](command:…)`
 * into text rather than a link. Line breaks become spaces so one value cannot
 * start a new block.
 */
export function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~$&:]/g, "\\$&").replace(/\r?\n|\r/g, " ");
}
