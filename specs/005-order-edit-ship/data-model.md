# Phase 1 Data Model: 訂單修改、刪除與出貨/CSV 分離

**Schema 變更：無。** 沿用既有 `orders` / `order_items`（見 `db/schema.sql`）。本功能只新增讀寫行為，不新增資料表、欄位、索引或 migration。

## 實體

### Order（`orders`，既有）

| 欄位 | 型別 | 本功能是否變動 | 備註 |
|------|------|----------------|------|
| id | serial PK | 唯讀識別 | API `[id]` 段、antd `rowKey="id"` |
| customer_name, phone, tag, delivery_method, pickup_spot_id, pickup_number, shipping_address, note | — | **不可變更**（FR-010） | 編輯只動明細；這些維持既有值 |
| total | integer | **會被重算更新** | 編輯後 = Σ 明細 subtotal |
| created_at | timestamptz | 不變 | |

**生命週期（新增概念，非 DB 狀態欄位）**：
`建立` →（可多次）`編輯品項` / 隨時 `刪除單筆` → 分組 `出貨` 時整組清除。無 status 欄位；「已出貨」等同「已從資料庫移除」。

### OrderItem（`order_items`，既有）

| 欄位 | 型別 | 快照規則 |
|------|------|----------|
| id | serial PK | 既有列以 id 辨識（編輯保留其快照） |
| order_id | int FK → orders ON DELETE CASCADE | 刪除訂單時自動清除明細 |
| product_id | int FK → products ON DELETE SET NULL | 商品被刪後為 NULL；該明細仍可改量／移除，但不能作為「新增」來源 |
| product_name, unit_price, promo_type, promo_config | 快照 | **既有列保留原始快照**；新增列取商品現值 |
| quantity | int CHECK > 0 | 編輯後每列必為正整數 |
| subtotal | int CHECK ≥ 0 | `calcLineSubtotal(promo, unit_price, quantity)`；既有改量用原快照重算，新增用現值計算 |

### Group（分組，衍生概念，既有）

出貨／匯出 CSV 的作用單位：每條路線一組、「未分路線」一組、「宅配」一組。由 `orders → pickup_spots → routes` 即時衍生（見 `getCloseGroups` / `deleteOrdersByGroup`）。本功能不改其定義。

## 驗證規則（對應 FR）

### 編輯訂單品項（`validateUpdateOrderItemsBody`，新增於 `app/lib/validation.ts`）

- `items` 必為**非空**陣列（FR-006：至少一項；空陣列 → 400「訂單至少需保留一項明細，如需清空請改用刪除訂單」）。
- 每列：
  - `quantity` 必為正整數（FR-005；否則 400「商品數量需為正整數」）。
  - 恰有 `id`（正整數）**或** `productId`（正整數）其一：
    - `id`：既有明細（伺服端須驗證該 id 屬於此訂單，否則 400）。
    - `productId`：新增明細（伺服端須驗證商品存在，否則 400；沿用 `OrderInputError`）。
- **重複合併**：同一 `id`（或同一新增 `productId`）之數量合併，避免同列重複（比照 `validateCreateOrderBody` 的合併行為）。
- 金額欄位一律忽略（後端計算）。

### 刪除訂單

- 路由 `[id]` 以 `parseId` 驗證為正整數；DELETE rowCount=0 → 訂單不存在（回 404/友善訊息）。

### 出貨 / 匯出 CSV（分組層級，既有驗證）

- 沿用 `deleteOrdersByGroup(method, routeId)` 與 `getCloseGroups`；出貨對空分組回「此分組目前沒有訂單」。

## 資料層新增函式（`app/lib/orders.ts`）

| 函式 | 職責 | 原子性 |
|------|------|--------|
| `getOrderById(id)` | 取單筆訂單＋明細（供編輯載入 / 回應） | 讀取 |
| `updateOrderItems(id, items)` | 依「最終明細清單」替換該訂單 `order_items` 並重算 `orders.total`；回傳更新後訂單或 null（不存在） | 單一 CTE（del + ins(unnest) + upd） |
| `deleteOrder(id)` | 刪除單筆訂單（明細 CASCADE）；回傳是否刪到 | 單語句 |
| `deleteOrdersByGroup(...)` | 既有；出貨清除分組 | 既有 |

`updateOrderItems` 內部：先 `getOrderById` 取既有明細快照 → 對帶 `id` 的列套用既有快照＋新量、對帶 `productId` 的列查 `products` 取現值快照 → 計算各 `subtotal` 與 `total` → 執行 CTE 替換。
