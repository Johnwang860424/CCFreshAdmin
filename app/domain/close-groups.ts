// 結單分組彙整邏輯：純函式、框架/DB 無關。
// SQL 聚合查詢在 app/lib/orders.ts；此處只負責把聚合列轉成分組摘要並排序。

/** 結單分組彙整：宅配為一組，自取則依「路線」（含未分路線）各成一組 */
export interface CloseGroupSummary {
  key: string;
  method: "pickup" | "delivery";
  /** 自取分組所屬路線 id；未分路線為 null。宅配為 null。 */
  routeId: number | null;
  display: string;
  count: number;
}

/**
 * 將 SQL 聚合列（snake_case：method / route_id / route_name / count）轉成分組摘要。
 * 自取以路線聚合（未分路線 route_id 為 NULL 自成一組）、宅配自成一組；
 * 自取排前、宅配排後，組內依名稱（zh-Hant）排序。
 */
export function summarizeCloseGroups(
  rows: Record<string, unknown>[],
): CloseGroupSummary[] {
  const groups: CloseGroupSummary[] = rows.map((r) => {
    const method = r.method as string;
    const count = r.count as number;
    if (method === "delivery") {
      return {
        key: "delivery",
        method: "delivery",
        routeId: null,
        display: "宅配",
        count,
      };
    }
    const routeId = (r.route_id as number) ?? null;
    return {
      key: `route:${routeId ?? "∅"}`,
      method: "pickup",
      routeId,
      display: (r.route_name as string) ?? "未分路線",
      count,
    };
  });

  // 自取點排前、宅配排後，組內依名稱排序
  return groups.sort((a, b) => {
    if (a.method !== b.method) return a.method === "pickup" ? -1 : 1;
    return a.display.localeCompare(b.display, "zh-Hant");
  });
}
