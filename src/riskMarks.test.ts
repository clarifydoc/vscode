import { describe, expect, it } from "vitest";
import { riskMark } from "./riskMarks";

describe("riskMark", () => {
  const v = { category: "edge", level: "high" as const, summary: "An edge of the system.", behaviourAtRisk: [], reasons: ["serves 4 routes", "called from 3 sub-projects", "no test", "fourth"] };

  it("badges high and critical apart, with the verdict as the tooltip", () => {
    expect(riskMark(v)).toEqual({
      badge: "!",
      color: "charts.orange",
      tooltip: "ClarifyDoc: high risk to change. An edge of the system. — serves 4 routes; called from 3 sub-projects; no test",
    });
    expect(riskMark({ ...v, level: "critical", reasons: [] })).toMatchObject({ badge: "!!", color: "charts.red", tooltip: "ClarifyDoc: critical risk to change. An edge of the system." });
  });
});
