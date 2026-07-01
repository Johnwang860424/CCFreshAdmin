# Contract: 匯出 CSV（獨立動作，不清除資料）

沿用既有 `POST /api/orders/close`（純匯出，不刪任何資料）。本功能只改前端：改為獨立「匯出 CSV」按鈕，不再與清除串接，可重複匯出。

## Auth

受 `proxy.ts` 全域守衛（分組匯出屬敏感讀取，建議 handler 內亦 `auth()`）。

## Request

`Content-Type: application/json`

```json
{ "method": "pickup", "routeId": 3 }
```

- `method`：`"pickup"` | `"delivery"`。
- `routeId`：路線 id｜`null`（未分路線）；`method="delivery"` 時忽略。

## Responses

| 狀態 | 條件 | Body |
|------|------|------|
| 200 | 有訂單 | `text/csv; charset=utf-8`，附 `Content-Disposition` 檔名 `orders_<分組>_<日期>.csv` |
| 400 | 分組無訂單 | `{ "error": "此分組目前沒有訂單" }`（中性訊息，去除「結單」字樣，匯出/出貨共用） |
| 500 | 未預期錯誤 | `{ "error": "..." }` |

## 行為要點

- **不刪除任何資料**（FR-017）；同分組可重複匯出得一致內容（SC-003）。
- CSV 欄位維持：取貨號、客戶姓名、來源、取貨地點、購買清單、訂單總額、電話（Excel 文字公式）、備註（FR-018）。
- 前端以 `downloadBlob` 觸發下載（既有）。

## Acceptance 對應

FR-017、FR-018；Spec US3 場景 1。
