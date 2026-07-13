# Contract: POST /api/orders 兩段式重複下單確認

**Date**: 2026-07-13 | **Plan**: [../plan.md](../plan.md)

擴充既有 `POST /api/orders`（後台新增訂單）。無新端點；授權沿用 `jsonHandler`（session + `ALLOWED_EMAILS`）。模式複用 009 站點改碼的 `requiresConfirmation` 契約。

## Request

既有 body 欄位不變，新增選用旗標：

```jsonc
{
  "customerName": "王小明",
  "phone": "0912345678",
  "tag": "網站",
  "deliveryMethod": "pickup",        // 或 "delivery"
  "pickupSpotId": 3,                  // pickup 時必填
  "shippingAddress": null,            // delivery 時必填
  "note": null,
  "items": [{ "productId": 1, "quantity": 2 }],
  "confirmDuplicate": true            // 選用；僅在收到 requiresConfirmation 後重送時帶
}
```

## 行為矩陣

| 條件 | 回應 |
|------|------|
| body 驗證失敗（既有規則） | `400 { error: ... }`（不變；先於重複檢查） |
| 同分組無同名訂單 | 照常建立 → `200 { success: true, id, pickupNumber, spotCode }`（不變） |
| 同分組有同名訂單 ∧ 未帶 `confirmDuplicate: true` | `409 { requiresConfirmation: true, duplicateCount: N, error: "系統偵測到您可能已有訂單。請確認是否為重複下單" }`，**不建立訂單、不革除快取** |
| 同分組有同名訂單 ∧ `confirmDuplicate === true` | 跳過檢查，照常建立 → `200`（回應同上） |
| `createOrder` 拋 `OrderInputError`（庫存不足、取貨點不存在等） | `400 { error: ... }`（不變；確認重複後仍可能發生） |

## 重複判定（伺服器端）

- **分組**：`deliveryMethod='pickup'` → 所選取貨點的 `route_id`（`NULL`＝未分路線），成員為同 `route_id`（`IS NOT DISTINCT FROM`）的自取訂單；`deliveryMethod='delivery'` → 全部宅配訂單。
- **同名**：`orders.customer_name` 與請求姓名（已 trim）完全相符；資料庫值由各寫入端保證已 trim（查詢不做 btrim）；電話不參與。
- **取貨點不存在**：檢查回 0、不出 409，由既有 `createOrder` 驗證回 400。
- 同名筆數不影響行為：`COUNT > 0` 即一次 409（`duplicateCount` 僅供參考，跳窗文字固定）。

## 前端（`app/(admin)/orders/page.tsx`）

- `handleCreate` 送出未帶旗標；catch `ApiError` 且 `body.requiresConfirmation === true` → `modal.confirm`：
  - `content` 逐字：「系統偵測到您可能已有訂單。請確認是否為重複下單」
  - `okText: "仍要建立"` → 帶 `confirmDuplicate: true` 重送；成功收尾與一般建立完全相同（成功訊息、關閉新增 Modal、重置表單、取貨號成功視窗、路線清單與當前視圖刷新）。
  - `cancelText: "取消"` → 只關確認窗；新增訂單 Modal 與已填內容保留。
- 其他錯誤（無 `requiresConfirmation`）→ 既有 `messageApi.error` 路徑不變。

## 相容性

- 未帶 `confirmDuplicate` 的既有呼叫端行為：僅在偵測到同名時多出 409 分支；無同名時回應與現行完全一致。
- 外部客購 App 不經此端點（直寫自身 DB），不受影響。
