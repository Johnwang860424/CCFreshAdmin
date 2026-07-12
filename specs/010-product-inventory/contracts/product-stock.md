# Contract: 商品庫存欄位與防超賣行為

**Date**: 2026-07-12 | **Plan**: [../plan.md](../plan.md) | **Data model**: [../data-model.md](../data-model.md)

無新端點；以下為既有端點的行為增量。所有變更端點顯式 `auth()` 檢查（縱深防禦，憲法原則 III）。

## GET /api/products

回傳的每個 `ProductRow` 增：

```ts
stock: number | null   // null＝不限量；0＝售完；>0＝剩餘可售
```

（沿用 `unstable_cache`；庫存異動端點負責 revalidate，見下。）

## POST /api/products（新增商品）

Request body 增（選填）：

```ts
stock?: number | null   // 缺省或 null＝不限量；否則須為非負整數
```

| 情況 | 回應 |
|------|------|
| `stock` 為非負整數或 null/缺省 | 照常 201 建立 |
| `stock` 為負數、小數、非數字 | `400 { error: "庫存必須為 0 或正整數" }` |

## PUT /api/products/[id]（編輯商品）

同 POST 的 `stock` 欄位規則；`stock: null` 表示改為不限量（清空追蹤）。管理員可任意調高調低（含 0、含低於已下訂量的值）——不做與既有訂單的交叉驗證（FR-003）。

## POST /api/orders（後台新增訂單）

- 成立訂單的同一原子語句內，依「每商品合計數量」扣減追蹤庫存商品的 `stock`；不限量商品不檢查不扣減。
- 成功後 revalidate `products` 快取。

| 情況 | 回應 |
|------|------|
| 全部品項庫存足夠 | 既有成功回應不變（`{ success, id, pickupNumber, spotCode }`），庫存已扣 |
| 任一品項合計數量 > 剩餘庫存 | `400 { error: "「商品名」庫存不足（剩餘 N）" }`（多品項不足時併列）；**整筆不成立、零扣減** |
| 預檢通過但寫入時被併發搶走（CHECK 23514） | 同上 400 格式（重查後組訊息）；零部分效果 |

## PUT /api/orders/[id]（編輯訂單品項）

- 以每商品「淨差額」（新合計 − 舊合計）檢查與扣/補，與 del/ins/total 同句原子：
  - 淨增（含新增品項）→ 檢查剩餘量並扣減；不足 → `400`（同上訊息格式），**整次編輯不生效**。
  - 淨減／移除品項 → 回補。
- `product_id` 為 NULL 的明細列（商品已刪）不參與扣補。
- 成功後 revalidate `products` 快取。

## DELETE /api/orders/[id]（刪除單筆訂單）

- 同一原子語句內回補該訂單全部追蹤庫存品項的合計數量（`product_id` NULL 者略過）。
- 成功後 revalidate `products` 快取。

## 出貨端點（零改動＝契約明示不回補）

- `POST /api/orders/close`（結單出貨）
- `POST /api/orders/selection`（選取出貨）

刪除訂單但**不回補庫存**（出貨＝實際售出；clarification 裁決）。

## UI 契約

### 商品管理頁（`products/page.tsx`）

- 新增/編輯表單：「庫存」`InputNumber`，min 0、整數、**可留空**（留空＝不限量）；無效值阻擋送出。
- 列表新增「庫存」欄：`null` → 「不限量」；`0` → 紅色「售完」Tag；`>0` → 數字。

### 訂單頁商品選單（`orders/page.tsx`，新增與編輯訂單共用）

- `stock === 0` 的商品：選項 `disabled` ＋「售完」標示（FR-011）。
- `stock > 0`：選項附「剩餘 N」。
- `stock === null`：無標示（現行外觀）。
- 數量欄不設前端上限；送出後的 400 錯誤訊息原樣顯示（既有錯誤通道）。

## 外部顧客端 App（out of scope，行為保證）

- App 的訂單寫入路徑零改動、不觸 `stock`（不扣減、不檢查）——FR-010。
- `products.stock` 為 additive 欄位，App 讀商品資料不受影響。
