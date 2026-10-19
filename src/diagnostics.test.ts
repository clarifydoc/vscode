import { describe, it, expect } from "vitest";
import * as vscode from "vscode";
import { routeMissDiag } from "./diagnostics";

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
