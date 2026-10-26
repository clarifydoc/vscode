import { describe, expect, it } from "vitest";
import { importedPackage, selectionWords } from "./askAgent";

describe("before-writing arguments from the editor", () => {
  it("reads a selection as one short line, comment markers dropped", () => {
    expect(selectionWords("  format a match\n   date ")).toBe("format a match date");
    expect(selectionWords("// format a match date")).toBe("format a match date");
    expect(selectionWords("# rank clubs by points")).toBe("rank clubs by points");
    expect(selectionWords("/* sum the goals */")).toBe("sum the goals");
    expect(selectionWords("   ")).toBeUndefined();
    expect(selectionWords("x".repeat(121))).toBeUndefined();
  });

  it("names the package an import line brings in", () => {
    expect(importedPackage(`import { format } from "date-fns";`)).toBe("date-fns");
    expect(importedPackage(`import { z } from "zod/v4";`)).toBe("zod");
    expect(importedPackage(`import { Garage } from '@league/cars/garage';`)).toBe("@league/cars");
    expect(importedPackage(`const axios = require("axios");`)).toBe("axios");
    expect(importedPackage(`import "reflect-metadata";`)).toBe("reflect-metadata");
    expect(importedPackage(`export { Club } from "league-kit";`)).toBe("league-kit");
    expect(importedPackage(`from requests.adapters import HTTPAdapter`)).toBe("requests");
    expect(importedPackage(`import numpy`)).toBe("numpy");
    expect(importedPackage(`import "github.com/club/league/standings"`)).toBe("github.com/club/league/standings");
  });

  it("never names a relative path, a project alias or a built-in", () => {
    expect(importedPackage(`import { Club } from "./club";`)).toBeUndefined();
    expect(importedPackage(`import { Club } from "@/models/club";`)).toBeUndefined();
    expect(importedPackage(`import { readFile } from "node:fs/promises";`)).toBeUndefined();
    expect(importedPackage(`import { db } from "#db/clubs";`)).toBeUndefined();
    expect(importedPackage(`from . import standings`)).toBeUndefined();
    expect(importedPackage(`const score = home + away;`)).toBeUndefined();
  });
});
