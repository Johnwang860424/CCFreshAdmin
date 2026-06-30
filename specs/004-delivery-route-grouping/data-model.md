# Phase 1 Data Model: 後台依「送貨路線」分組

## Schema 變更（`db/schema.sql`）

### 新表 `routes`

```sql
CREATE TABLE routes (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
```

- `name`：路線顯示名稱，唯一（DB 層保證；違反 → SQLSTATE 23505）。
- 路線之間不需排序（無 `sort_order`）。

### `pickup_spots` 新增欄位

```sql
ALTER TABLE pickup_spots
  ADD COLUMN route_id INTEGER REFERENCES routes(id) ON DELETE RESTRICT;
```

- 允許 `NULL` = 未分路線。
- `ON DELETE RESTRICT`：路線仍被取貨點引用時，DB 拒絕刪除（與 `products.category_id` 同模式）。
- 允許 `NULL` = 未分路線。`route_id` 僅為後台分組屬性。
- 既有 `UNIQUE (city, township)` 與 `sort_order`（同縣市內 1-based，供前台選點）**皆不變**（見 research D3）。索引維持 `idx_pickup_spots_city_sort (city, sort_order)`，不新增 route 排序索引。

### 一次性 Migration（手動於 Neon 執行，並更新 `db/schema.sql`）

```sql
-- 1) 建立路線表
CREATE TABLE routes (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- 2) 取貨點掛上路線（既有列 route_id 預設 NULL → 自動落入「未分路線」）
ALTER TABLE pickup_spots
  ADD COLUMN route_id INTEGER REFERENCES routes(id) ON DELETE RESTRICT;
```

- 既有取貨點與其訂單無需搬遷即落入未分路線（FR-026 / SC-006）。
- 訂單表（`orders` / `order_items`）**不動**（憲法 V）。

## 實體關係

```text
routes (1) ──< (N) pickup_spots ──< (N) orders ──< (N) order_items
   id            route_id (NULL=未分路線)   pickup_spot_id     order_id
                 sort_order (per-route)     (NULL/宅配)
```

- 訂單的「路線」為衍生屬性：`orders → pickup_spots.route_id → routes`，查詢時即時 JOIN，不快照於訂單列。
- 宅配訂單（`delivery_method='delivery'`）無取貨點、無路線，獨立為「宅配」分組。

## 資料層型別（TypeScript）

### `app/lib/routes.ts`（新，比照 `categories.ts`）

```ts
interface RouteDbRow { id: number; name: string; spot_count: number; }
export interface RouteRow { id: number; name: string; spotCount: number; }

export const getRoutes: () => Promise<RouteRow[]>;            // unstable_cache, tag "routes"，含取貨點計數，ORDER BY id
export function addRoute(name: string): Promise<void>;        // 23505 → 由 route 層轉「路線名稱重複」
export function renameRoute(id: number, name: string): Promise<void>;
export function deleteRoute(id: number): Promise<void>;       // 呼叫端先 countSpotsInRoute 擋刪
export function countSpotsInRoute(id: number): Promise<number>;
```

### `app/lib/pickup-spots.ts`（改）

```ts
export interface PickupSpotRow {
  id: number;
  city: string;
  township: string;
  sortOrder: number;
  routeId: number | null;     // 新增：NULL = 未分路線
  routeName: string | null;   // 新增：JOIN routes 取得；未分路線為 null
}

// getPickupSpots：LEFT JOIN routes，ORDER BY city, sort_order, id（排序維持以縣市分群，供前台顧客選點）
// addPickupSpot(city, township, routeId): sort_order = 該縣市 MAX+1；route_id 為附加屬性
// updatePickupSpotTownship(id, township): 僅改地點（route_id 不動）—— 自取點管理頁用（路線唯讀）
// updatePickupSpot(id, township, routeId): 改 township 與 route_id —— 路線管理頁修改自取點用；不動 sort_order
// reorderPickupSpots(city: string, ids): WHERE p.city = ${city}（維持既有 003 的縣市內排序）
//
// PUT /api/pickup-spots/[id]：body 含 routeId 欄位才更新所屬路線（→updatePickupSpot），否則只改地點（→updatePickupSpotTownship）。
```

### `app/lib/orders.ts`（改）

```ts
export interface OrderRow {
  /* …既有欄位不變… */
  routeId: number | null;     // 新增：經取貨點關聯；宅配或未分路線為 null
  routeName: string | null;   // 新增；宅配/未分路線/取貨點已刪除為 null
}

// getOrdersByRoute(routeId: number | null): OrderRow[]     // 取代 getOrdersByLocation；自取訂單依路線（null=未分路線）
// getOrderRoutes(): { routes: {id,name}[]; hasUnassigned: boolean; hasDelivery: boolean }
//                                                          // 訂單管理篩選（US3）下拉來源：僅含有訂單的路線
// getRouteOrderMatrix(route: number | "unassigned" | "all", from: string, to: string): RouteOrderMatrix
//                                                          // 取代 getCityOrderMatrix；route+日期區間，詳見下方
// getCloseGroups(): CloseGroupSummary[]                    // 改以 route 聚合（+未分路線 +宅配）
// deleteOrdersByGroup(method, routeId?: number | null)     // 自取改以 route 刪除

// 訂單統計（order-summary）下拉來源改用 routes.ts 的 getRoutes()（全部路線），
// 使無訂單路線也可被選取而顯示空表；getOrderRoutes() 僅供訂單管理篩選。

export interface RouteOrderMatrix {
  // 查詢回顯：route 為 number(指定路線) | "unassigned"(未分路線) | "all"(全部路線)
  route: number | "unassigned" | "all";
  routeName: string | null;          // 指定路線的名稱；未分路線/全部路線為 null（UI 以文案處理）
  from: string;                      // 套用之日期區間起（YYYY-MM-DD，台北時區）
  to: string;                        // 套用之日期區間訖
  products: string[];                // 範圍內訂單出現過的商品，依 products.sort_order 排序（已刪商品排最後）
  rows: {                            // 每個「取貨點」一列
    pickupSpotId: number;
    label: string;                   // city + township
    quantities: Record<string, number>;
  }[];
  productTotals: Record<string, number>;
}
//
// 列順序：route=number/"unassigned" → 該（單一）路線取貨點依 sort_order；
//        route="all" → 跨路線所有「範圍內有訂單」的取貨點，ORDER BY route_id NULLS LAST, sort_order, ps.id。
// 日期過濾：(o.created_at AT TIME ZONE 'Asia/Taipei')::date BETWEEN ${from} AND ${to}（參數化，含起訖兩端）。
// route 過濾：number/"unassigned" → WHERE ps.route_id IS NOT DISTINCT FROM ${routeId}；"all" → 不加 route 條件。

export interface CloseGroupSummary {
  key: string;                       // "route:<id>" | "route:∅"(未分路線) | "delivery"
  method: "pickup" | "delivery";
  routeId: number | null;            // 取代 pickupSpotId
  display: string;                   // 路線名 / "未分路線" / "宅配"
  count: number;
}
```

## 驗證規則（對應 FR）

| 規則 | 來源 | 落點 |
|------|------|------|
| 路線名稱必填、`trim`、≤ `MAX_LEN.routeName`(50) | FR-001/FR-003 | `app/api/routes/route.ts`、`[id]/route.ts` |
| 路線名稱唯一 | FR-002 | DB `UNIQUE` + 23505 → 友善訊息 |
| 仍有取貨點時擋刪 | FR-004/FR-005 | `countSpotsInRoute` + `ON DELETE RESTRICT`(23503) |
| 取貨點固定屬一條路線（可空=未分路線） | FR-006/FR-007 | `route_id` 單一外鍵欄位 |
| 取貨點顯示順序可調（縣市內，供前台選點） | FR-008 | `sort_order`(per-city) + `reorderPickupSpots(city, ids)` |
| 縣市/鄉鎮保留 | FR-009 | `pickup_spots.city/township` 不動 |
| 統計查詢＝路線+日期區間、擇一必填、日期預設今天、清空皆無→400 | FR-010 | `app/api/orders/summary/route.ts` + 頁面 |
| 統計列＝取貨點×商品＋總量（有路線:該路線依sort_order；無路線:跨路線所有有訂單取貨點依sort_order） | FR-011/FR-012 | `getRouteOrderMatrix(route, from, to)` |
| 統計 CSV 匯出（含套用之路線/日期條件） | FR-012 | `order-summary/page.tsx` |
| 「未分路線」可選為統計一組 | FR-013 | 統計下拉（`getRoutes` + 未分路線/全部路線選項） |
| 訂單僅讀/匯出/清除 | FR-025 | 無對 orders 的 UPDATE |
