# Contract: PUT /api/orders/[id] — 修改訂單品項

改既有訂單的商品明細（新增／移除／改數量）。不改客戶／取貨等欄位（FR-010）。金額後端計算。

## Auth

受 `proxy.ts` 全域守衛；handler 內另呼叫 `auth()`（縱深防禦，原則 III）。

## Request

`Content-Type: application/json`

```json
{
  "items": [
    { "id": 123, "quantity": 3 },
    { "productId": 45, "quantity": 1 }
  ]
}
```

- `items`：非空陣列（FR-006）。每列 `quantity` 正整數（FR-005）。
- 每列擇一：`id`（既有明細，須屬本訂單，保留其單價/促銷快照）或 `productId`（新增明細，取商品現值快照）。
- 未列出的既有明細 = 移除。重複 `id`/`productId` 合併數量。金額欄位忽略。

## Responses

| 狀態 | 條件 | Body |
|------|------|------|
| 200 | 成功 | 更新後訂單（含 `items` 與重算後 `total`），形狀同 `OrderRow` |
| 400 | 無效 id 格式 | `{ "error": "無效的 ID 格式" }` |
| 400 | 空 items | `{ "error": "訂單至少需保留一項明細，如需清空請改用刪除訂單" }` |
| 400 | 數量非正整數 | `{ "error": "商品數量需為正整數" }` |
| 400 | `productId` 商品不存在 | `{ "error": "部分商品不存在，請重新選擇" }` |
| 400 | `id` 不屬於此訂單 | `{ "error": "明細資料錯誤，請重新載入" }` |
| 404 | 訂單不存在（並發刪除/出貨） | `{ "error": "訂單不存在，可能已被刪除或出貨" }` |
| 500 | 未預期錯誤 | `{ "error": "..." }`（jsonHandler） |

## 行為要點

- 既有明細（帶 `id`）：`subtotal = calcLineSubtotal(既有 promo, 既有 unit_price, 新 quantity)`。
- 新增明細（帶 `productId`）：以 `products` 現值建立 `product_name/unit_price/promo_*` 快照後計算 `subtotal`。
- `orders.total = Σ subtotal`。
- 原子替換：單一 CTE（DELETE 舊明細 + INSERT 新集合(unnest) + UPDATE total），`upd` 無回列即回 404。

## Acceptance 對應

FR-001..FR-010；Spec US1 場景 1–5。
