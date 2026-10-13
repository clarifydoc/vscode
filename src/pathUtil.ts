import * as path from "path";

/**
 * `target`'s path relative to `root`, forward-slashed, when it lies strictly
 * inside `root` — undefined for `root` itself and for anything outside it. A
 * relative `target` is taken relative to `root`. Containment is decided on the
 * resolved path, so `a/../../x` is outside however it is spelled, and a name
 * that merely starts with two dots (`..cache`) is still inside.
 */
export function relativeInside(root: string, target: string): string | undefined {
  const rel = path.relative(root, path.resolve(root, target));
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep).join("/");
}
