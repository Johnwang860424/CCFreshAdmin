import { describe, expect, it } from "vitest";
import { summarizeCloseGroups } from "./close-groups";

describe("summarizeCloseGroups", () => {
  it("自取依路線成組、未分路線自成一組、宅配自成一組", () => {
    const groups = summarizeCloseGroups([
      { method: "delivery", route_id: null, route_name: null, count: 4 },
      { method: "pickup", route_id: 1, route_name: "山線", count: 10 },
      { method: "pickup", route_id: null, route_name: null, count: 2 },
    ]);

    expect(groups).toEqual([
      { key: "route:1", method: "pickup", routeId: 1, display: "山線", count: 10 },
      {
        key: "route:∅",
        method: "pickup",
        routeId: null,
        display: "未分路線",
        count: 2,
      },
      { key: "delivery", method: "delivery", routeId: null, display: "宅配", count: 4 },
    ]);
  });

  it("自取排前、宅配排後，組內依名稱（zh-Hant）排序", () => {
    const groups = summarizeCloseGroups([
      { method: "delivery", route_id: null, route_name: null, count: 1 },
      { method: "pickup", route_id: 2, route_name: "海線", count: 1 },
      { method: "pickup", route_id: 1, route_name: "山線", count: 1 },
    ]);
    expect(groups.map((g) => g.display)).toEqual([
      ["山線", "海線"].sort((a, b) => a.localeCompare(b, "zh-Hant"))[0],
      ["山線", "海線"].sort((a, b) => a.localeCompare(b, "zh-Hant"))[1],
      "宅配",
    ]);
    expect(groups[2].method).toBe("delivery");
  });

  it("空輸入回空陣列", () => {
    expect(summarizeCloseGroups([])).toEqual([]);
  });
});
