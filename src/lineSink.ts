/**
 * Re-cut streamed process output into whole lines. A log channel stamps every
 * write with a time and level, so a chunk boundary in the middle of a line
 * must not become two entries. Blank lines are dropped; `end()` flushes a
 * last line that had no newline.
 */
export function lineSink(write: (line: string) => void): { push(chunk: string): void; end(): void } {
  let rest = "";
  return {
    push(chunk: string) {
      rest += chunk;
      const lines = rest.split(/\r?\n|\r/);
      rest = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) write(line);
    },
    end() {
      if (rest.trim()) write(rest);
      rest = "";
    },
  };
}
