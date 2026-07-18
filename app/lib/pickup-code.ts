// 取貨號碼顯示格式：站點代碼＋來源字母＋流水號（如 A5 / AL5 / AS5）。
// 站點代碼來自 pickup_spots.code 欄位（管理員維護，1–3 大寫英文字母，同路線內唯一），
// 由訂單查詢 JOIN 即時帶出（OrderRow.spotCode）——純顯示層組合，訂單不快照代碼，
// DB 仍只存整數 pickup_number。
// 來源字母依訂單 tag 而定：FB 無字母（維持原格式）、Line 加「L」、網站加「S」；
// 流水號序列依來源各自獨立遞增（見 order-writes.ts 的取號與 orders 唯一鍵）。

/** 訂單來源 → 取貨號中的來源字母（FB 與未知來源不加字母，維持原格式）。 */
function sourceLetter(tag: string): string {
  if (tag === "Line") return "L";
  if (tag === "網站") return "S";
  return "";
}

/**
 * 組出取貨號碼的顯示字串：
 * - 自取（spotCode 非 null）：站點代碼＋來源字母＋流水號，如 "A5"（FB）/ "AL5"（Line）/ "AS5"（網站）。
 * - 宅配（spotCode 為 null）：來源字母＋流水號，如 "7"（FB）/ "L7" / "S7"。
 * - pickupNumber 為 null（防禦）：回傳 null，呼叫端顯示「-」。
 */
export function formatPickupCode(
  spotCode: string | null,
  pickupNumber: number | null,
  tag: string,
): string | null {
  if (pickupNumber == null) return null;
  return `${spotCode ?? ""}${sourceLetter(tag)}${pickupNumber}`;
}
