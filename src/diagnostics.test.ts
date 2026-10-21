import { describe, it, expect } from "vitest";
import * as vscode from "vscode";
import { contractDiag, routeMissDiag, securityDiag } from "./diagnostics";

const folder = { uri: vscode.Uri.file("/repo"), name: "repo", index: 0 } as unknown as vscode.WorkspaceFolder;

describe("routeMissDiag", () => {
  it("warns on a refused method and points at the route that exists", () => {
    const d = routeMissDiag(
      { file: "web/a.ts", line: 3, method: "DELETE", url: "/api/cars", reason: "method-mismatch", existing: [{ method: "GET", path: "/api/cars", file: "api/o.py", line: 9 }] },
      folder,
    );
    expect(d.severity).toBe(vscode.DiagnosticSeverity.Warning);
    expect(d.code).toBe("route-miss");
    expect(d.message).toBe("DELETE /api/cars asks for a method the route does not serve; the backend serves GET /api/cars");
    expect(d.relatedInformation!.map((r) => [r.location.uri.fsPath, r.message])).toEqual([["/repo/api/o.py", "GET /api/cars"]]);
  });

  it("only informs about a path no route has", () => {
    const d = routeMissDiag({ file: "web/b.ts", line: 5, method: "GET", url: "/v1/charges", reason: "unmatched" }, folder);
    expect(d.severity).toBe(vscode.DiagnosticSeverity.Information);
    expect(d.relatedInformation).toBeUndefined();
  });
});

describe("contractDiag", () => {
  it("names the field and points at the route", async () => {
    const d = contractDiag({ file: "web/api.ts", line: 4, method: "POST", url: "/players", route: { file: "api/players.ts", line: 6, path: "/players" }, kind: "missing-field", field: "age" }, folder);
    expect(d.message).toBe('POST /players does not send "age", which /players requires');
    expect(d.severity).toBe(vscode.DiagnosticSeverity.Warning);
    expect(d.relatedInformation![0]!.location.uri.fsPath).toBe("/repo/api/players.ts");
  });
});

describe("securityDiag", () => {
  it("names the tool and its rule on a finding imported from another tool's SARIF", () => {
    const d = securityDiag({ category: "sql-injection", severity: "high", message: "Tainted SQL string", filePath: "api/q.py", line: 12, cwe: "CWE-89", tool: "Semgrep", ruleId: "python.lang.security.sqli" }, folder, { routes: [] });
    expect(d.source).toBe("ClarifyDoc · Semgrep");
    expect(d.message).toBe("sql-injection [python.lang.security.sqli]: Tainted SQL string");
    expect((d.code as { value: string }).value).toBe("CWE-89");
    const own = securityDiag({ category: "hardcoded-secret", severity: "high", message: "Hardcoded secret", filePath: "a.ts", line: 1 }, folder, { routes: [] });
    expect([own.source, own.code, own.message]).toEqual(["ClarifyDoc", "hardcoded-secret", "Hardcoded secret"]);
    const noCwe = securityDiag({ category: "external", severity: "medium", message: "x", filePath: "a.ts", line: 2, tool: "gosec", ruleId: "G104" }, folder, { routes: [] });
    expect([noCwe.code, noCwe.message]).toEqual(["G104", "external [G104]: x"]);
  });

  it("lists a taint finding's steps as related locations, the sink itself left out", () => {
    const d = securityDiag({
      category: "sql-injection", severity: "high", message: "Request input reaches the SQL text", filePath: "api/players.java", line: 6,
      flow: [
        { line: 3, note: "request parameter name" },
        { line: 5, note: "sql carries it" },
        { line: 2, note: "called from here", file: "api/Other.java" },
        { line: 6, note: "reaches the SQL text of jdbcTemplate.query()" },
      ],
    }, folder, { routes: [] });
    expect(d.relatedInformation!.map((r) => [r.location.uri.fsPath, r.location.range.start.line + 1, r.message])).toEqual([
      ["/repo/api/players.java", 3, "1. request parameter name"],
      ["/repo/api/players.java", 5, "2. sql carries it"],
      ["/repo/api/Other.java", 2, "3. called from here"],
    ]);
  });
});
