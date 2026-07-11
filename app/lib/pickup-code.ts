// 取貨號碼顯示格式：站點代碼＋流水號（如 A5）。
// 站點代碼來自 pickup_spots.code 欄位（管理員維護，1–3 大寫英文字母，同路線內唯一），
// 由訂單查詢 JOIN 即時帶出（OrderRow.spotCode）——純顯示層組合，訂單不快照代碼，
// DB 仍只存整數 pickup_number，寫入端（後台與顧客端 App）完全不受影響。

/**
 * 組出取貨號碼的顯示字串：
 * - 自取（spotCode 非 null）：站點代碼＋流水號，如 "A5"。
 * - 宅配（spotCode 為 null）：維持自身序列的純數字，如 "7"。
 * - pickupNumber 為 null（防禦）：回傳 null，呼叫端顯示「-」。
 */
export function formatPickupCode(
  spotCode: string | null,
  pickupNumber: number | null,
): string | null {
  if (pickupNumber == null) return null;
  if (spotCode == null) return String(pickupNumber);
  return `${spotCode}${pickupNumber}`;
}
