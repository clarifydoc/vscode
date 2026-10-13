/**
 * The line-comment token for a VS Code language id, for inserting a
 * suppression comment. Only languages with a line comment are listed; for the
 * rest no suppression is offered rather than a guess.
 */
const LINE_COMMENT: Record<string, string> = {};
for (const id of [
  "typescript", "typescriptreact", "javascript", "javascriptreact", "java", "csharp", "go", "rust",
  "swift", "kotlin", "php", "scala", "c", "cpp", "objective-c", "objective-cpp", "dart", "fsharp",
  "groovy", "zig", "d", "v", "haxe", "vue", "svelte", "scss", "less", "jsonc", "cuda-cpp",
]) LINE_COMMENT[id] = "//";
for (const id of [
  "python", "ruby", "shellscript", "perl", "r", "yaml", "elixir", "powershell", "julia", "crystal",
  "raku", "nim", "coffeescript", "dockerfile", "makefile", "toml", "mojo",
]) LINE_COMMENT[id] = "#";
for (const id of ["sql", "lua", "haskell", "ada"]) LINE_COMMENT[id] = "--";
for (const id of ["clojure", "lisp", "scheme", "racket", "autohotkey", "autoit"]) LINE_COMMENT[id] = ";";
LINE_COMMENT.erlang = "%";
LINE_COMMENT.vb = "'";
LINE_COMMENT.bat = "REM";
LINE_COMMENT.fortran = "!";
LINE_COMMENT.pascal = "//";
// OCaml, HTML and CSS have block comments only: not listed.

export function lineCommentFor(languageId: string): string | undefined {
  return LINE_COMMENT[languageId] || undefined;
}

/** The line to insert above `lineText` so the scanner skips the line below it. */
export function suppressionLine(languageId: string, lineText: string): string | undefined {
  const token = lineCommentFor(languageId);
  if (!token) return undefined;
  const indent = /^\s*/.exec(lineText)?.[0] ?? "";
  return `${indent}${token} clarifydoc-ignore-next-line\n`;
}
