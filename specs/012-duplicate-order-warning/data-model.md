# Data Model: 新增訂單重複下單警示

**Date**: 2026-07-13 | **Plan**: [plan.md](./plan.md)

## Schema 變更

**無。** 不新增資料表、欄位、索引或約束；`db/schema.sql` 不動。

## 既有實體（唯讀取用）

### orders（既有）

| 欄位 | 用途（本功能） |
|------|----------------|
| `customer_name` | 比對鍵來源：與新訂單姓名（已 trim）完全相符即同名 |
| `delivery_method` | `'pickup'` / `'delivery'`——決定分組路徑 |
| `pickup_spot_id` | JOIN `pickup_spots` 取 `route_id` 推導路線分組 |

### pickup_spots（既有）

| 欄位 | 用途（本功能） |
|------|----------------|
| `route_id` | 路線分組鍵；`NULL` ＝ 未分路線分組 |

## 推導值（不落地）

### 路線分組（route group）

新訂單所屬分組，僅存在於檢查查詢的比對條件中：

- `deliveryMethod = 'pickup'` → 分組 = 所選取貨點的 `route_id`（含 `NULL` ＝ 未分路線）；成員 = 所有 `delivery_method='pickup'` 且其取貨點 `route_id IS NOT DISTINCT FROM` 目標值的訂單。
- `deliveryMethod = 'delivery'` → 分組 = 宅配；成員 = 所有 `delivery_method='delivery'` 的訂單。

與 011 重複下訂篩選的「路線視圖」語意一致（路線／未分路線／宅配互斥）。

### 同名判定鍵

`customer_name` 的完全相符（大小寫、內部空白、全形/半形均不正規化；電話不參與）。輸入端姓名已由 `validateCreateOrderBody` trim；資料庫既有值由各寫入端（後台與外部客購 App）保證已 trim，故查詢直接以 `=` 比對、不做 btrim。

## 查詢（新增於 `app/lib/orders.ts`）

`countSameNameOrdersInGroup({ customerName, deliveryMethod, pickupSpotId }): Promise<number>`

- **pickup 路徑**（單一語句）：

  ```sql
  WITH target AS (SELECT route_id FROM pickup_spots WHERE id = ${pickupSpotId})
  SELECT COUNT(*)::int AS count
  FROM orders o
  JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
  CROSS JOIN target t
  WHERE o.delivery_method = 'pickup'
    AND ps.route_id IS NOT DISTINCT FROM t.route_id
    AND o.customer_name = ${customerName}
  ```

  取貨點不存在 → `target` 空 → 回 0（不誤報；錯誤由 `createOrder` 既有驗證回報）。

- **delivery 路徑**：

  ```sql
  SELECT COUNT(*)::int AS count
  FROM orders o
  WHERE o.delivery_method = 'delivery'
    AND o.customer_name = ${customerName}
  ```

- **唯讀**：不 UPDATE/INSERT 任何列、不留標記（FR-008）；不觸發任何快取革除。

## 狀態轉移

無——本功能不新增任何持久狀態。`confirmDuplicate` 旗標僅存在於單次 POST 請求 body 中。
