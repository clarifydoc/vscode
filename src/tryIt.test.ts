import { describe, expect, it } from "vitest";
import { buildRequest, curlText, httpFileText, pathPlaceholders, skeleton } from "./tryIt";

const create = {
  httpMethod: "PUT",
  path: "/api/v2/clubs/:clubId/players",
  auth: { policies: ["ManageSquad"], roles: [], schemes: [], anonymous: false },
  params: [
    { name: "clubId", binding: "route" },
    { name: "dryRun", binding: "query" },
    { name: "player", binding: "body" },
  ],
  requestSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      shirt: { type: "integer" },
      signedOn: { type: "string", format: "date-time" },
      position: { type: "string", enum: ["keeper", "striker"] },
      contract: { type: "object", properties: { years: { type: "number" }, fee: { type: "object", properties: { amount: { type: "number" } } } } },
      tags: { type: "array", items: { type: "string" } },
    },
  },
};

describe("try it: the request a route implies", () => {
  it("writes path params, query, bearer auth and a typed body", () => {
    const text = httpFileText(create);
    expect(text).toContain("PUT {{baseUrl}}/api/v2/clubs/{{clubId}}/players?dryRun={{dryRun}} HTTP/1.1");
    expect(text).toContain("Authorization: Bearer {{token}}");
    expect(text).toContain("Content-Type: application/json");
    const body = JSON.parse(text.slice(text.indexOf("{\n")));
    expect(body).toEqual({
      name: "string",
      shirt: 0,
      signedOn: "2024-01-01T00:00:00Z",
      position: "keeper",
      contract: { years: 0, fee: { amount: 0 } },
      tags: ["string"],
    });
    expect(text).toContain("@clubId = ");
    expect(text).toContain("@token = ");
  });

  it("an anonymous GET has no auth header and no body", () => {
    const text = httpFileText({ httpMethod: "GET", path: "/api/v2/clubs/{id}", auth: { anonymous: true } });
    expect(text).toBe("@baseUrl = http://localhost:3000\n@id = \n\n### GET /api/v2/clubs/{id}\nGET {{baseUrl}}/api/v2/clubs/{{id}} HTTP/1.1\n");
  });

  it("an unguarded route and a GET with a body schema stay without auth and body", () => {
    const r = buildRequest({ httpMethod: "GET", path: "/matches", requestSchema: { type: "object" } });
    expect(r.headers).toEqual([]);
    expect(r.body).toBeUndefined();
  });

  it("picks basic and API-key headers from the scheme", () => {
    expect(buildRequest({ path: "/a", auth: { schemes: ["Basic"] } }).headers[0]).toEqual(["Authorization", "Basic {{credentials}}"]);
    expect(buildRequest({ path: "/a", auth: { schemes: ["ApiKey"] } }).headers[0]).toEqual(["X-API-Key", "{{apiKey}}"]);
  });

  it("reads every path-parameter spelling", () => {
    expect(pathPlaceholders("/a/:id/b/{n}/c/<int:k>/d/[slug]")).toEqual({ path: "/a/{{id}}/b/{{n}}/c/{{k}}/d/{{slug}}", names: ["id", "n", "k", "slug"] });
  });

  it("caps the body's depth", () => {
    let node: any = { type: "string" };
    for (let i = 0; i < 10; i++) node = { type: "object", properties: { next: node } };
    expect(JSON.stringify(skeleton(node))).toBe('{"next":{"next":{"next":{"next":{}}}}}');
  });

  it("copies as curl with shell variables, executing nothing", () => {
    const curl = curlText(create);
    expect(curl).toContain('curl -X PUT "$BASE_URL/api/v2/clubs/$CLUB_ID/players?dryRun=$DRY_RUN"');
    expect(curl).toContain('-H "Authorization: Bearer $TOKEN"');
    expect(curl).toContain("-d '{");
  });
});
