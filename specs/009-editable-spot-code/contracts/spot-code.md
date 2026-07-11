# Contract: 站點代碼（欄位、API、顯示組合）

> rev. 2026-07-11：唯一性範圍改為同路線內；新增改分路線撞碼行為。

## 1. 代碼值域

- 1–3 個大寫英文字母（`^[A-Z]{1,3}$`）；輸入端接受小寫，正規化為大寫。
- **同路線內唯一**（「未分路線」視為一個群組）；跨路線允許同碼。
- 由管理員維護；系統不自動產生（僅 migration 依路線重編回填一次）。

## 2. API — `POST /api/pickup-spots`（新增站點）

Request body（新增欄位）：

```jsonc
{ "city": "新北市", "township": "板橋區", "routeId": 1, "code": "G" }  // code 必填
```

| 情境 | 回應 |
|------|------|
| code 缺漏或格式不符 | `400 { error: "站點代碼須為 1–3 個英文字母" }` |
| 所屬路線（含未分路線）已有同碼站點 | `409 { error: "同路線已有相同代碼的站點" }` |
| 成功 | `200 { success: true }` |

## 3. API — `PUT /api/pickup-spots/[id]`（編輯站點）

Request body：

```jsonc
{
  "township": "板橋區",
  "code": "D",                  // 自取點管理頁送出；格式同上
  "routeId": 2,                 // 僅路線管理頁帶（不帶 code）
  "confirmCodeChange": true     // 選用；僅在收到 requiresConfirmation 後重送時帶
}
```

行為：

| 情境 | 回應 |
|------|------|
| code 有變 ∧ 該站點尚有訂單 ∧ 未帶 `confirmCodeChange` | `409 { requiresConfirmation: true, orderCount: N, error: "此站點尚有 N 筆未出貨訂單，修改代碼將立即改變其取貨號" }` |
| code 有變 ∧ 帶 `confirmCodeChange: true` | 執行更新 → `200` |
| code 未變（或未帶 code，如路線管理頁） | 既有行為，不觸發確認 |
| code 與同路線既有站點重複 | `409 { error: "同路線已有相同代碼的站點" }` |
| **改分路線（帶 routeId）且該站代碼與目標路線既有站點重複** | `409 { error: "同路線已有相同代碼的站點，請先修改其中一站的代碼" }`（由 DB 唯一鍵擋下，FR-008） |
| code 格式不符 | `400` |

- 判斷「尚有訂單」以 DB 即時查詢為準（`orders.pickup_spot_id = id`），不用快取。
- `requiresConfirmation` 回應與其他 409 的區別欄位即 `requiresConfirmation: true`，前端據此開確認 Modal 而非直接顯示錯誤。

## 4. 顯示組合 — `formatPickupCode`（app/lib/pickup-code.ts）

```ts
function formatPickupCode(
  spotCode: string | null,   // OrderRow.spotCode（JOIN pickup_spots.code；宅配 null）
  pickupNumber: number | null,
): string | null;
```

| 輸入 | 輸出 |
|------|------|
| `("A", 5)` | `"A5"` |
| `(null, 7)`（宅配） | `"7"` |
| `(_, null)`（防禦） | `null`（呼叫端顯示「-」） |

- 消費端：訂單管理頁（欄位 render + 搜尋，不分大小寫比對）、`order-export.ts`（結單/選取匯出「取貨號」欄）。三處必須同源。
- `spotCodeFromId` 停用刪除；回填邏輯僅存在於 migration SQL。
- 注意：跨路線可能出現相同顯示號碼（兩路線各有 A5），屬規格接受行為。

## 5. 讀取 — `GET /api/pickup-spots`

`PickupSpotRow` 增加 `code: string`；自取點管理頁表格新增「代碼」欄，新增/編輯表單含代碼輸入。

## 6. 回填（migration 006，一次性）

- 分組：`PARTITION BY route_id`（NULL＝未分路線自成一組）。
- 排序：組內依 `id`（建立順序）。
- 編碼：`row_number()` 轉 Excel 式字母（1→A…26→Z、27→AA…），每組自 A 起算。
- 效果：既有訂單顯示前綴改變、流水號不變（放棄零感，使用者裁決）。
