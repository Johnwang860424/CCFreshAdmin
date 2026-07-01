# Contract: 匯出選取訂單為 xlsx

**Endpoint**: `POST /api/orders/selection`

**用途**: 將被勾選的訂單（依 id 清單）匯出為 xlsx 檔（依縣市分頁），只下載、不清除資料、可重複（FR-004 / FR-005）。

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
| 200 | 至少一筆存在 | xlsx 二進位，`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`，`Content-Disposition: attachment; filename*=UTF-8''訂單_YYYY-MM-DD.xlsx` |
| 400 | `ids` 格式錯誤 | `{ "error": "選取資料格式錯誤" }` |
| 400 | `ids` 皆已不存在（`getOrdersByIds` 回空） | `{ "error": "選取的訂單皆已不存在，請重新載入" }` |
| 401 | 未登入 | `{ "error": "未授權" }` |
| 500 | 未預期錯誤 | `{ "error": "匯出訂單失敗" }` |

## 檔案內容規則（沿用既有匯出，FR-005）

- 由 `buildOrdersWorkbook(orders)` 產生；欄位表頭：取貨號、客戶姓名、取貨地點、購買清單、訂單總額、電話、備註。
- 依縣市分工作表（tab）；宅配歸「宅配」頁、無縣市（取貨點已刪除）歸「未分縣市」頁；縣市名稱以 `zh-Hant` 穩定排序。
- 只含 `ids` 中仍存在的訂單（部分已刪/出貨者略過，FR-010）。

## 邊界

- 前端於 0 勾選時停用按鈕，不會送出（FR-007）；後端仍以 `validateOrderIdsBody` 防禦。
- 資料不被更動，可重複呼叫得相同內容（FR-004）。
