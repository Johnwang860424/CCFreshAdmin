# Phase 0 Research: 後台依「送貨路線」分組

所有設計決策皆以「比照既有 `categories` / `pickup_spots` / `orders` 模式、最小變更」為原則。下列為需明確拍板的點。

## D1. 路線儲存模型

- **Decision**: 新 `routes` 表 `(id SERIAL PK, name TEXT NOT NULL UNIQUE)`；`pickup_spots` 加 `route_id INTEGER REFERENCES routes(id) ON DELETE RESTRICT`，允許 NULL。
- **Rationale**: 與 `categories` 同構 —— 名稱唯一由 DB `UNIQUE` 保證、改名只動一列、`ON DELETE RESTRICT` 在 DB 層擋刪被引用的路線。NULL 自然表達「未分路線」，既有列 migration 後自動落入該組，無需資料搬遷（符合 FR-026/SC-006）。
- **Alternatives rejected**: 在 `pickup_spots` 直接存 route 文字 → 無唯一性、改名要全表更新、無法擋刪。路線間排序欄位 → spec 明確非目標，不加。

## D2. 「未分路線」與「宅配」的表示

- **Decision**: 兩者皆為內建虛擬分組，非 `routes` 列。
  - 未分路線 = `pickup_spots.route_id IS NULL` 的取貨點及其訂單；資料層以 `route_id IS NOT DISTINCT FROM NULL`（或 `IS NULL`）比對，API/UI 以「特殊值」表示（見 D6）。
  - 宅配 = `orders.delivery_method = 'delivery'`，沿用既有判定，與取貨點/路線無關。
- **Rationale**: 不污染 `routes` 表（不可被改名/刪除），且宅配本就無結構化取貨點。符合 spec 假設與 R5「各自獨立可結單的一組」。
- **Alternatives rejected**: 為「未分路線」建一筆保留 route 列 → 需處處防止被刪改、且既有列要回填該 id，違背「免遷移」目標。

## D3. `sort_order` 群組維度：維持「縣市」（前台顧客選點用）

- **Decision**: `sort_order` 語意維持既有（feature 003）「同縣市內 1-based」**不變**。`route_id` 僅為後台分組屬性，與排序無關。
  - 自取點管理頁維持以「縣市」分 tab、縣市內拖拉排序；`reorderPickupSpots(city, ids)` 以 `WHERE p.city = ${city}` 原子重寫；`getPickupSpots` 維持 `ORDER BY city, sort_order, id`。
  - 新增取貨點：`sort_order` 取「該縣市」目前最大值 +1。
  - 改派路線：只更新 `route_id`，**不動** `sort_order`（縣市未變，排序不變）。
- **Rationale**: 此排序驅動**前台顧客**選取貨點的呈現順序（非後台路線作業），故必須維持以縣市分群、與前台一致。route 只是疊加在取貨點上的後台分組標籤。統計交叉表的取貨點列序即依此縣市內 sort_order 呈現（`getRouteOrderMatrix` `ORDER BY ps.city, ps.sort_order, ps.id`）。
- **Alternatives rejected**: 把 `sort_order` 改為「同路線內」→ 會破壞前台顧客選點順序（前台依縣市分群選點），且與既有 003 行為不一致。

## D4. 訂單↔路線關聯：即時 JOIN（不快照）

- **Decision**: 訂單不新增 route 欄位；查詢時 `orders → pickup_spots → routes` 即時 JOIN 取得 `route_id`/`route_name`。
- **Rationale**: 符合憲法 V（不寫訂單列）與 spec 假設「以查詢當下歸屬為準，無歷史快照需求」。取貨點改派路線後，統計/結單範圍即時反映。
- **Alternatives rejected**: 在 `orders` 快照 route → 與「即時反映改派」矛盾，且改動訂單寫入（前台 App，明確非目標）。

## D5. 結單分組與刪除改以路線為單位

- **Decision**:
  - `getCloseGroups()` 改以 route 聚合：每條「有自取訂單」的路線一組（key `route:<id>`）＋「未分路線」（`route:∅`，若有 route_id IS NULL 的自取訂單）＋「宅配」（若有）。
  - CSV：一條路線一份，涵蓋線上所有取貨點訂單；「取貨地點」欄輸出 `pickup_spot_label`（**縣市+鄉鎮**）以區分同路線各取貨點——路線可跨縣市，同名鄉鎮（如不同縣市的「中正區」）只靠鄉鎮無法區分，故需含縣市（FR-018）。檔名帶路線名（未分路線/宅配各自命名）。
  - `deleteOrdersByGroup` 改吃 `{ method, routeId }`：宅配照舊刪 `delivery_method='delivery'`；自取刪 `delivery_method='pickup'` 且 `pickup_spot_id IN (SELECT id FROM pickup_spots WHERE route_id IS NOT DISTINCT FROM ${routeId})`。
  - `filterGroup`（close POST 記憶體過濾）同步改以訂單的 `routeId` 比對。
- **Rationale**: R5 整條路線一份 CSV、兩階段（先下載成功再清除）、宅配/未分路線各自獨立。`pickup_number` 規則完全不動（仍每取貨點各自遞增），符合 FR-021。
- **風險**：CSV 內同路線多點訂單混在一份；以既有「取貨地點＝鄉鎮」欄區分即可，無需新欄位。

## D6. 「未分路線」在 API/前端的特殊值表示

- **Decision**: route 篩選/結單參數以 query string 或 body 的 `route` 表達：具體路線用其數字 id；未分路線用保留字 `unassigned`（或 body `routeId: null`）；宅配用既有 `method=delivery`。資料層函式簽名以 `routeId: number | null` 表達（null = 未分路線）。
- **Rationale**: 明確區分「未分路線（null）」與「未帶參數（列清單）」兩種狀態，避免 falsy 混淆。沿用 orders GET「無參數回清單、有參數回資料」的既有形態。
- **Alternatives rejected**: 用 `route=0` 代表未分路線 → 與「無參數」及合法 id 邊界易混淆。

## D7. 驗證與錯誤訊息

- **Decision**: 比照 `categories`：route 名稱必填、`trim`、長度上限（新增 `MAX_LEN.routeName`，採 50 與分類一致）、唯一性違反（Postgres `23505`）回友善訊息「路線名稱重複」。刪除前 `countSpotsInRoute(id)`，>0 回 400「此路線仍有 N 個取貨點，無法刪除」；DELETE 與計數間競態違反 FK（`23503`）亦回同類訊息。`validatePickupReorderBody` 由 `{ city, ids }` 改為 `{ routeId: number|null, ids }`。
- **Rationale**: 與既有擋刪/重名 UX 一致（R1）。

## D8. Cache tag

- **Decision**: 新增 cache tag `"routes"`，`getRoutes` 以 `unstable_cache` 包裝；route 寫入後 `revalidateCache("routes")`。取貨點寫入涉及 route 顯示時，沿用既有 `"pickup-spots"` tag（`getPickupSpots` JOIN routes，故改派/路線改名後需一併 `revalidateCache("pickup-spots")`）。
- **Rationale**: 與既有 tag 模式一致，確保前台同步。路線改名會影響取貨點顯示的 routeName → 改名 API 同時 revalidate `routes` 與 `pickup-spots`。

## D9. 訂單統計：路線 + 日期區間查詢（clarify 2026-06-30）

- **Decision**: 訂單統計（`order-summary`）查詢條件由「單一路線」擴充為「路線」＋「日期區間」，兩者擇一必填、可同時給（取交集）。
  - **三態 route 參數**：`order-summary` 的 route 參數需區分三種狀態，故較 D6 多一個「全部路線」態：
    - 省略 / `route=all` → **全部路線**：列＝該日期區間內有自取訂單的所有取貨點（跨所有路線）。
    - `route=<id>` → 指定路線。
    - `route=unassigned` → 未分路線（`route_id IS NULL`）。
  - **日期欄位**：`from`、`to`（`YYYY-MM-DD`），預設皆為今天（台北時區）。資料層以 `(o.created_at AT TIME ZONE 'Asia/Taipei')::date BETWEEN ${from} AND ${to}` 參數化過濾（含起訖兩端）。
  - **函式簽名**：`getRouteOrderMatrix(route: number | "unassigned" | "all", from: string, to: string)`。`"all"` 時 `ORDER BY route_id NULLS LAST, sort_order, ps.id`；指定/未分路線時 `WHERE ps.route_id IS NOT DISTINCT FROM ${routeId}`。列只含「該範圍內有訂單」的取貨點（沿用既有「只列有訂單的列」行為）。
  - **下拉來源改 `getRoutes()`（全部路線）**：統計頁路線下拉改列「全部路線 / 各路線 / 未分路線」（來源 `getRoutes`，非 `getOrderRoutes`），使無訂單的路線也可被選取而顯示空表（解決 analyze G1：edge case「某路線沒有訂單時統計顯示為空」變為可達）。`getOrderRoutes`（僅有訂單的路線）保留供 **訂單管理篩選**（US3）使用。
  - **伺服端守衛**：若未給 route（含非 `all`）且未給日期 → 回 400「請至少指定路線或日期」。前端因日期預設今天，正常情況一律帶日期。
  - **掃描範圍**：日期區間僅作用於統計；訂單管理篩選與結單分組不受日期影響（沿用既有）。
- **Rationale**: 符合 clarify 決議（擇一必填、預設今天、無路線時跨路線列出所有取貨點依 `sort_order`）。改用 `getRoutes` 當下拉來源順帶修掉 analyze G1。日期以台北時區比對與既有 `taipeiDateStamp` 結單檔名時區一致。
- **Alternatives rejected**: 沿用 `getOrderRoutes` 當統計下拉 → 無訂單路線不可選、edge case 不可達；以 UTC 比對日期 → 與營運所在時區不符、跨日邊界錯誤。
