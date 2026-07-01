# Contract: 出貨（清除）選取訂單

**Endpoint**: `DELETE /api/orders/selection`

**用途**: 永久清除被勾選的訂單（依 id 清單），不下載檔案（FR-003）。沿用「出貨即刪除、無法復原」語意，作用範圍為任意勾選集合。

**Auth**: 受 `proxy.ts` 全域守衛；handler 內另顯式 `auth()`，未登入回 401（原則 III）。

## Request

Headers: `Content-Type: application/json`

Body:

```json
{ "ids": [12, 15, 27] }
```

- `ids`：非空、正整數、去重的訂單 id 陣列（`validateOrderIdsBody`）。

## Responses

| 狀態 | 情境 | 內容 |
|------|------|------|
| 200 | 完成（含部分 id 已不存在） | `{ "deleted": 3 }`（實際刪除筆數；`order_items` 由 CASCADE 一併清除） |
| 400 | `ids` 格式錯誤 | `{ "error": "選取資料格式錯誤" }` |
| 401 | 未登入 | `{ "error": "未授權" }` |
| 500 | 未預期錯誤 | `{ "error": "清除訂單失敗" }` |

## 語意

- 以 `deleteOrdersByIds(ids)` 執行單一 `DELETE ... WHERE id = ANY(${ids}) RETURNING id`，原子且天然忽略已消失者（FR-010）。
- `deleted` 供前端提示實際處理筆數；即使小於送出的 id 數也視為成功（部分已被他處刪/出貨）。

## 前端流程

- 執行前顯示確認視窗，載明將清除的筆數、警示無法復原並建議先匯出備份（FR-006）。
- 成功後清空勾選並刷新路線清單與目前路線訂單（FR-009）。
- 0 勾選時按鈕停用（FR-007）。
