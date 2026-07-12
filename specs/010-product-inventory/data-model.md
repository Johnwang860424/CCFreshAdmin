# Data Model: 商品庫存管理與防止超賣

**Date**: 2026-07-12 | **Plan**: [plan.md](./plan.md)

## 變更總覽

僅一個實體變更：`products` 新增 `stock` 欄。無新表、無新關聯；`orders`／`order_items` 結構不變（庫存不快照——它是即時計數器，非訂單歷史的一部分）。

## products（修改）

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| `stock` | `INTEGER` | nullable；`CONSTRAINT products_stock_nonneg CHECK (stock IS NULL OR stock >= 0)` | 剩餘可售數量。**NULL＝不限量（不追蹤）**；`0`＝售完。既有商品不回填（維持 NULL） |

### Migration `db/migrations/007_add_product_stock.sql`

```sql
ALTER TABLE products
  ADD COLUMN stock INTEGER,
  ADD CONSTRAINT products_stock_nonneg CHECK (stock IS NULL OR stock >= 0);
```

`db/schema.sql` 同步加入同欄位與具名約束（憲法 Development Workflow：手動於 Neon SQL Editor 執行，PR 說明遷移步驟）。

### 不變式（invariants）

1. `stock` 永不為負——由具名 CHECK 在 DB 層保證，所有寫入路徑共用（SC-001 的最終防線）。
2. 追蹤庫存商品（`stock IS NOT NULL`）的扣減/回補**只**發生在：後台訂單成立（扣）、訂單品項淨增（扣）、訂單品項淨減/移除（補）、單筆訂單刪除（補）、管理員直接編輯（任意改）。出貨（結單/選取出貨）與顧客端 App 下單不觸碰 `stock`。
3. 扣減/回補與對應的訂單寫入永遠在同一條 SQL 語句內（原子；憲法原則 V）。
4. 不限量商品（`stock IS NULL`）不參與任何檢查與扣補（`WHERE stock IS NOT NULL` 過濾）。

## 狀態語意（非欄位、由 stock 值衍生）

| stock 值 | 商品列表顯示 | 訂單商品選單行為 |
|----------|--------------|------------------|
| `NULL` | 「不限量」 | 可選，不檢查不扣減 |
| `> 0` | 剩餘數字 | 可選，附「剩餘 N」；送出時檢查＋扣減 |
| `0` | 「售完」標示 | **disabled ＋「售完」**（FR-011）；伺服器端同樣拒絕 |

## TypeScript 資料形狀

### `app/lib/products.ts`

- `ProductRow` 增 `stock: number | null`（`ProductDbRow` 同步）。
- `getProducts()` SELECT 增 `p.stock`。
- `addProduct(…, stock: number | null)`、`updateProductDetails(…, stock: number | null)`：INSERT/UPDATE 增 `stock` 欄。

### `app/lib/validation.ts`

- `validateProductBody`：body 增 `stock` —— 接受 `null`／缺省（→ null）或非負整數（`Number.isInteger && >= 0`），其餘 400「庫存必須為 0 或正整數」。

### `app/lib/orders.ts`

- `ProductSnapshot` 增 `stock: number | null`（createOrder 既有商品查詢多帶一欄，兼作預檢資料）。
- `ExistingItemSnapshot` 增 `quantity: number`（淨差額計算需要舊數量）。
- 庫存不足錯誤：沿用 `OrderInputError` 通道（HTTP 400），訊息「「商品名」庫存不足（剩餘 N）」；23514＋constraint 名 `products_stock_nonneg` 分流為競態後援。

## 每商品合計規則

檢查與扣減一律以「該訂單中同一 `product_id` 的合計數量」為單位（同商品多列時避免 `UPDATE … FROM` 重複列陷阱；spec edge case）。`product_id IS NULL` 的明細列（商品已刪除）不參與扣補。
