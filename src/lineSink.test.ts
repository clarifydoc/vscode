import { describe, expect, it } from "vitest";
import { lineSink } from "./lineSink";

describe("lineSink", () => {
  it("joins a line split across chunks", () => {
    const out: string[] = [];
    const sink = lineSink((l) => out.push(l));
    sink.push("Analyzing src/a");
    sink.push(".ts\nAnalyzing src/b.ts\nDo");
    expect(out).toEqual(["Analyzing src/a.ts", "Analyzing src/b.ts"]);
    sink.push("ne");
    sink.end();
    expect(out).toEqual(["Analyzing src/a.ts", "Analyzing src/b.ts", "Done"]);
  });

  it("drops blank lines and handles CRLF", () => {
    const out: string[] = [];
    const sink = lineSink((l) => out.push(l));
    sink.push("a\r\n\r\n  \nb\r\n");
    sink.end();
    expect(out).toEqual(["a", "b"]);
  });
});
