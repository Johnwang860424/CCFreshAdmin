// 庫存不足訊息的組字邏輯：純函式、框架/DB 無關。
// 庫存的檢查與原子扣減在 app/lib/orders.ts 的 SQL CTE；此處只負責組人話錯誤訊息。

/**
 * 對照「每商品需求量」與目前剩餘庫存，組「庫存不足」錯誤訊息；全部足夠回 null。
 * 訊息格式為 SC-003 契約：「商品名」庫存不足（剩餘 N），多筆以「；」併列。
 * stock 為 null 表不限量（不追蹤庫存），一律視為足夠。
 */
export function stockInsufficiencyMessage(
  rows: { id: number; name: string; stock: number | null }[],
  wantedByProductId: Map<number, number>,
): string | null {
  const parts = rows
    .filter(
      (r) => r.stock !== null && (wantedByProductId.get(r.id) ?? 0) > r.stock,
    )
    .map((r) => `「${r.name}」庫存不足（剩餘 ${r.stock}）`);
  return parts.length > 0 ? parts.join("；") : null;
}
