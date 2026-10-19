import { describe, it, expect } from "vitest";
import * as vscode from "vscode";
import { contractDiag, routeMissDiag } from "./diagnostics";

const folder = { uri: vscode.Uri.file("/repo"), name: "repo", index: 0 } as unknown as vscode.WorkspaceFolder;

describe("routeMissDiag", () => {
  it("warns on a refused method and points at the route that exists", () => {
    const d = routeMissDiag(
      { file: "web/a.ts", line: 3, method: "DELETE", url: "/api/orders", reason: "method-mismatch", existing: [{ method: "GET", path: "/api/orders", file: "api/o.py", line: 9 }] },
      folder,
    );
    expect(d.severity).toBe(vscode.DiagnosticSeverity.Warning);
    expect(d.code).toBe("route-miss");
    expect(d.message).toBe("DELETE /api/orders asks for a method the route does not serve; the backend serves GET /api/orders");
    expect(d.relatedInformation!.map((r) => [r.location.uri.fsPath, r.message])).toEqual([["/repo/api/o.py", "GET /api/orders"]]);
  });

  it("only informs about a path no route has", () => {
    const d = routeMissDiag({ file: "web/b.ts", line: 5, method: "GET", url: "/v1/charges", reason: "unmatched" }, folder);
    expect(d.severity).toBe(vscode.DiagnosticSeverity.Information);
    expect(d.relatedInformation).toBeUndefined();
  });
});

describe("contractDiag", () => {
  it("names the field and points at the route", async () => {
    const d = contractDiag({ file: "web/api.ts", line: 4, method: "POST", url: "/users", route: { file: "api/users.ts", line: 6, path: "/users" }, kind: "missing-field", field: "age" }, folder);
    expect(d.message).toBe('POST /users does not send "age", which /users requires');
    expect(d.severity).toBe(vscode.DiagnosticSeverity.Warning);
    expect(d.relatedInformation![0]!.location.uri.fsPath).toBe("/repo/api/users.ts");
  });
});
