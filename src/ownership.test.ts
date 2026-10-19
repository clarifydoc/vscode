import { describe, expect, it } from "vitest";
import { ownershipLine } from "./ownership";

describe("ownershipLine", () => {
  const history = {
    churn: new Map([
      ["src/pay.ts", { commits: 12, authors: ["Ada", "Bo"], shares: [{ name: "Ada", commits: 10 }, { name: "Bo", commits: 2 }], busFactor: 1 }],
      ["src/new.ts", { commits: 2, authors: ["Cy"], busFactor: 1 }],
    ]),
    ownersOf: (f: string) => (f.startsWith("src/pay") ? ["@acme/payments"] : []),
  };

  it("names the owners, the main authors, and a file one person holds", () => {
    expect(ownershipLine("src/pay.ts", history)).toBe("$(person) owned by **@acme/payments** · mostly Ada (10), Bo (2) · one person made most of its changes");
  });

  it("does not call two commits a bus factor, and says nothing without history", () => {
    expect(ownershipLine("src/new.ts", history)).toBe("$(person) mostly Cy");
    expect(ownershipLine("src/other.ts", history)).toBeNull();
    expect(ownershipLine("src/pay.ts", undefined)).toBeNull();
  });
});
