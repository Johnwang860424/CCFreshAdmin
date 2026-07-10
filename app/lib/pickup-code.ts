// 取貨號碼顯示格式：站點代碼＋流水號（如 A5）。
// 站點代碼由不可變的 pickup_spot_id 以 Excel 式雙射 26 進位換算而得（1→A、26→Z、27→AA），
// 純顯示層衍生——DB 仍只存整數 pickup_number，寫入端（後台與顧客端 App）完全不受影響。
// 注意：代碼只能由 id 衍生，不可改用 sort_order 等可變欄位，否則站點增刪/重排會讓既有訂單號碼漂移。

/** 站點 id → 英文代碼（Excel 式雙射 26 進位；id 為 serial 正整數）。 */
export function spotCodeFromId(id: number): string {
  let n = id;
  let code = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    code = String.fromCharCode(65 + rem) + code;
    n = Math.floor((n - 1) / 26);
  }
  return code;
}

/**
 * 組出取貨號碼的顯示字串：
 * - 自取（spotId 非 null）：站點代碼＋流水號，如 "A5"。
 * - 宅配（spotId 為 null）：維持自身序列的純數字，如 "7"。
 * - pickupNumber 為 null（防禦）：回傳 null，呼叫端顯示「-」。
 */
export function formatPickupCode(
  spotId: number | null,
  pickupNumber: number | null,
): string | null {
  if (pickupNumber == null) return null;
  if (spotId == null) return String(pickupNumber);
  return `${spotCodeFromId(spotId)}${pickupNumber}`;
}
