# Phase 1 API Contracts: 後台依「送貨路線」分組

所有 route 沿用 `jsonHandler`（例外→500 在地化）、`parseId`、`revalidateCache`、`validate*` 模式。錯誤回應形態 `{ error: string }`，HTTP 4xx；成功 mutate 回 `{ success: true }`。所有路徑受 `proxy.ts` 中介層守衛。

---

## 新增：`/api/routes`（比照 `/api/categories`）

### `GET /api/routes`
- **回應 200**：`RouteRow[]` → `[{ id, name, spotCount }]`（含取貨點計數，`ORDER BY id`）。

### `POST /api/routes`
- **Body**：`{ name: string }`
- **驗證**：`trim` 非空；長度 ≤ `MAX_LEN.routeName`(50)。
- **400**：`路線名稱為必填欄位` / `路線名稱不可超過 50 字`。
- **409/400**：名稱重複（23505）→ `路線名稱重複`。
- **成功**：`addRoute` → `revalidateCache("routes")` → `{ success: true }`。

### `PUT /api/routes/[id]`
- **Body**：`{ name: string }`；同上驗證 + `parseId`。
- **成功**：`renameRoute` → `revalidateCache("routes")` + `revalidateCache("pickup-spots")`（取貨點顯示的 routeName 受影響）→ `{ success: true }`。

### `DELETE /api/routes/[id]`
- `parseId`；`countSpotsInRoute(id)` > 0 → **400** `此路線仍有 N 個取貨點，無法刪除`。
- 競態 FK 違反（23503）→ **400** 同類訊息。
- **成功**：`deleteRoute` → `revalidateCache("routes")` → `{ success: true }`。

---

## 變更：`/api/pickup-spots`

### `POST /api/pickup-spots`
- **Body**：`{ city, township, routeId?: number | null }`（`routeId` 省略/`null` = 未分路線）。
- `addPickupSpot(city, township, routeId)`；`sort_order` 取該**縣市** MAX+1（供前台選點順序）。
- `revalidateCache("pickup-spots")`。

### `PUT /api/pickup-spots/[id]`
- **Body**：`{ township, routeId? }`（township 必填可改；city 不可變）。**僅當 body 含 `routeId` 欄位時才更新所屬路線**：
  - 含 `routeId`（number 或 null）→ `updatePickupSpot`（改地點＋路線）—— 路線管理頁修改自取點。
  - 不含 `routeId` → `updatePickupSpotTownship`（只改地點，route 不動）—— 自取點管理頁（路線唯讀）。
- **不動** `sort_order`（縣市未變，前台排序不變）。
- 維持 `PickupSpotDuplicateError`(23505)→409 `同縣市已有相同地點`。
- `revalidateCache("pickup-spots")`。

### `PUT /api/pickup-spots/reorder`
- **Body 不變**：`{ city, ids }`（排序維持以縣市分群，供前台顧客選點）。
- `validatePickupReorderBody` 驗 `city`（非空字串）+ `ids`（非空、正整數、不重複）。
- `reorderPickupSpots(city, ids)`（`WHERE p.city = ${city}`）。
- `revalidateCache("pickup-spots")`。

---

## 變更：`/api/orders`（GET 篩選維度 city→route）

### `GET /api/orders`
- **無參數** → `{ routes: {id,name}[], hasUnassigned: boolean, hasDelivery: boolean }`（取代 `{ locations, hasDelivery }`）。
- **`?method=delivery`** → 宅配訂單 `OrderRow[]`（不變）。
- **`?route=<id>`** → 該路線各取貨點的自取訂單 `OrderRow[]`。
- **`?route=unassigned`** → 未分路線（`route_id IS NULL`）自取訂單 `OrderRow[]`。
- 移除 `city`/`township` 參數路徑。
- POST（新增訂單）**不變**。

---

## 變更：`/api/orders/summary`（縣市統計→路線統計＋日期區間）

### `GET /api/orders/summary`
- **下拉清單載入**（無 `route` 且無 `from`/`to`）→ `{ routes: {id,name}[] }`：來自 `getRoutes()`（**全部路線**，含無訂單者），供統計頁路線下拉（全部路線 / 各路線 / 未分路線）。
- **統計查詢**（route 與/或日期，擇一必填）→ `RouteOrderMatrix`：
  - `route`：`<id>`（指定路線）｜ `unassigned`（未分路線）｜ `all` 或省略（全部路線、跨路線）。
  - `from`、`to`（`YYYY-MM-DD`）：日期區間，含起訖兩端，以台北時區比對 `created_at`；前端預設兩者皆今天。
  - 行為：`getRouteOrderMatrix(route, from, to)`（列＝取貨點、欄＝商品數量、附 `productTotals`；列序見 data-model.md）。
- **守衛**：未指定有效 route（`all`/`<id>`/`unassigned`）且未帶 `from`/`to` → **400** `請至少指定路線或日期`。
- 移除 `city` 參數。
- 註：日期區間僅作用於統計；訂單管理篩選（`/api/orders`）與結單（`/api/orders/close`）不受日期影響。

---

## 變更：`/api/orders/close`（結單分組 spot→route）

### `GET /api/orders/close`
- 回 `{ groups: CloseGroupSummary[] }`，分組改以 route 聚合（每條有自取訂單的路線一組 + 未分路線 + 宅配）。`key`：`route:<id>` / `route:∅` / `delivery`。

### `POST /api/orders/close`（第一步：僅下載，不刪）
- **Body**：`{ method?: "pickup"|"delivery", routeId?: number | null }`（取代 `pickupSpotId`）。
- `filterGroup` 改以訂單 `routeId` 比對；宅配照舊。
- 空組 → **400** `此分組目前沒有訂單可結單`。
- CSV header 不變（`取貨號,客戶姓名,來源,取貨地點,購買清單,訂單總額,電話,備註`）；「取貨地點」欄自取輸出**縣市+地點**（`pickupSpotLabel`，確保同路線跨縣市時同名鄉鎮也可區分）、宅配輸出地址。
- 檔名 `orders_<路線名|未分路線|宅配>_<台北日期>.csv`。
- 回 `text/csv`（200）。

### `DELETE /api/orders/close`（第二步：確認下載成功後才清除）
- **Body**：`{ method?, routeId?: number | null }`。
- `deleteOrdersByGroup(method ?? "pickup", routeId ?? null)`：宅配刪 `delivery`；自取刪 `pickup_spot_id IN (SELECT id FROM pickup_spots WHERE route_id IS NOT DISTINCT FROM routeId)`。
- 維持兩階段：下載失敗（POST 非 2xx）前端不得呼叫 DELETE（FR-019）。

---

## 前端 API client（`app/lib/api-client.ts`）
- 既有 `postJson/putJson/deleteJson/fetchJson/downloadBlob` 不需新增；各頁改傳新參數/body 即可。
