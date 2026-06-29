# Phase 1 Data Model: 後台新增訂單與來源標籤

## Schema 變更

### `orders`（新增欄位）

```sql
ALTER TABLE orders ADD COLUMN tag TEXT NOT NULL DEFAULT '網站';
```

- 新欄位 `tag`：訂單來源標籤。`NOT NULL`，DB 預設 `'網站'`。
- 既有列：套用 DEFAULT 後即為 `'網站'`（若 DB 版本不自動回填，補一次 `UPDATE orders SET tag = '網站' WHERE tag IS NULL`）。
- 應用層允許值：`網站`、`FB`、`Line`（不在 DB 層加 CHECK，驗證於 `validateCreateOrderBody`）。
- `db/schema.sql` 須同步把 `tag` 加入 `CREATE TABLE orders` 定義，並於 PR 說明 migration。

其餘 `orders` / `order_items` 欄位不變（見 `db/schema.sql`）。

## 實體

### Order（訂單）

| 欄位 | 型別 | 說明 | 來源 |
|------|------|------|------|
| id | serial | 主鍵 | DB 產生 |
| customer_name | text | 客戶姓名（必填、非空） | 表單 |
| phone | text? | 電話（選填） | 表單 |
| delivery_method | text | `pickup` 或 `delivery` | 表單 |
| pickup_spot_id | int? | 自取點 FK（宅配為 NULL） | 表單（自取） |
| pickup_number | int? | 取貨號碼牌（自取遞增；宅配 NULL） | 系統指派 |
| shipping_address | text? | 宅配地址（宅配必填） | 表單（宅配） |
| note | text? | 備註 | 表單 |
| total | int | 訂單總額（= 各明細 subtotal 加總） | 系統計算 |
| **tag** | **text** | **來源標籤：網站/FB/Line，預設網站** | **表單（預設網站）** |
| created_at | timestamptz | 建立時間 | DB 預設 now() |

### OrderItem（訂單明細）— 不變

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | serial | 主鍵 |
| order_id | int | FK → orders（ON DELETE CASCADE） |
| product_id | int? | FK → products（ON DELETE SET NULL） |
| product_name | text | 商品名稱快照 |
| unit_price | int | 單品原價快照 |
| quantity | int | 數量（> 0） |
| promo_type | text? | 促銷快照 |
| promo_config | jsonb? | 促銷參數快照 |
| subtotal | int | 折後小計快照（≥ 0） |

關係：`Order 1 — N OrderItem`。

## 驗證規則（建立訂單）

對應 spec FR-002~FR-008、FR-010、FR-011、FR-014：

- `customerName`：trim 後非空。
- `tag`：須為 `網站 / FB / Line` 之一；未提供時預設 `網站`。
- `deliveryMethod`：須為 `pickup` 或 `delivery`。
  - `pickup`：`pickupSpotId` 須為存在的取貨點 id；若系統無任何取貨點則拒絕（FR-011）。
  - `delivery`：`shippingAddress` trim 後非空；`pickupSpotId` 應為 NULL。
- `items`：非空陣列；每項 `productId` 為存在商品、`quantity` 為正整數。
  - 重複 `productId` 合併數量為單一明細（edge case）。
  - 找不到的 `productId` → 拒絕。
- `unitPrice / subtotal / total`：**不接受前端值**，一律由後端依商品目前 `price`＋促銷以 `calcLineSubtotal` 計算；`total = Σ subtotal`，須 ≥ 0。

## 狀態與不可變性

- 訂單建立為 append-only；建立後本功能不提供修改／刪除（清除沿用既有「結單」流程）。
- 明細快照欄位（`product_name/unit_price/promo_*/subtotal`）於建立當下定版，後續商品價格／促銷變動不影響既有訂單（原則 V）。
