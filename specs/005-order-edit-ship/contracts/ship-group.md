# Contract: 出貨（清除分組，不下載 CSV）

沿用既有 `DELETE /api/orders/close`（純清除分組），移除「須先下載 CSV」的前置。UI 上原「結單」按鈕更名「出貨」（FR-014）。

## Auth

受 `proxy.ts` 全域守衛；handler 內另呼叫 `auth()`（原則 III）。

## Request

`Content-Type: application/json`

```json
{ "method": "pickup", "routeId": 3 }
```

- 語意同匯出：`method` + `routeId`（`delivery` 時忽略 routeId）。

## Responses

| 狀態 | 條件 | Body |
|------|------|------|
| 200 | 清除成功 | `{ "success": true }` |
| 500 | 未預期錯誤 | `{ "error": "清除訂單失敗" }` |

## 行為要點

- 呼叫既有 `deleteOrdersByGroup(method, routeId)`：宅配清全部宅配、指定路線清該路線所有取貨點、未分路線清 `route_id IS NULL` 及無取貨點者（`order_items` CASCADE 清除）。
- **不產生 / 不下載 CSV**（FR-015）；資料模型不新增狀態欄位。
- 為不可復原操作：前端執行前顯示不可復原確認（FR-016）。
- 出貨後同分組新訂單取貨號碼自然自 1 起算（既有行為）。
- 空分組由前端不提供可執行出貨（US3 場景 4）；後端匯出（POST）對空分組回中性 400「此分組目前沒有訂單」（與匯出共用訊息，去除「結單」字樣）。

## Acceptance 對應

FR-014..FR-016；Spec US3 場景 2–4。
