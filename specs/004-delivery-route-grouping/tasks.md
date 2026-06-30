---
description: "Task list for 後台依「送貨路線」分組（取代縣市分組）"
---

# Tasks: 後台依「送貨路線」分組（取代縣市分組）

**Input**: Design documents from `specs/004-delivery-route-grouping/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md

**Tests**: 無測試框架（專案無 test runner）；不產生測試任務。驗證以 `npm run lint` + `npm run build` + `quickstart.md` 手動流程為準。

**Organization**: 依 spec 的 4 個 user story 分組（US1/US2 為 P1、US3 為 P2、US4 為 P3），各 story 可獨立實作與驗收。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、無未完成相依）
- **[Story]**: US1/US2/US3/US4，對應 spec user story

## Path Conventions

單一 Next.js App Router 專案，路徑相對 repo root（`app/...`、`db/...`）。

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 結構描述變更的單一真實來源（source of truth）。

- [X] T001 在 `db/schema.sql` 新增 `routes` 表（`id SERIAL PK, name TEXT NOT NULL UNIQUE`）並對 `pickup_spots` 加 `route_id INTEGER REFERENCES routes(id) ON DELETE RESTRICT`（允許 NULL）；補上 data-model.md 的一次性 migration 區塊註解

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: DB 實際具備 `routes` 表與 `pickup_spots.route_id` 欄位，否則所有資料層 JOIN/查詢都會失敗。

**⚠️ CRITICAL**: 完成前不可開始任何 user story。

- [ ] T002 ⏳ **需使用者操作**：於 Neon SQL Editor 執行 `db/migrations/004_add_routes.sql`（建立 `routes` 表、`ALTER TABLE pickup_spots ADD COLUMN route_id ...`、改建 `(route_id, sort_order)` 索引）；確認既有 `pickup_spots` 列 `route_id` 為 NULL（落入未分路線）。`orders`/`order_items` 不得更動。（程式碼依賴此欄存在；未套用前 `/routes`、`/pickup-spots`、訂單頁讀取會失敗）

**Checkpoint**: DB 已就緒，US1–US4 可開始。

---

## Phase 3: User Story 1 - 建立與維護送貨路線 + 取貨點歸屬 (Priority: P1) 🎯 MVP

**Goal**: 管理員可新增/改名/刪除路線（名稱唯一、仍有取貨點時擋刪），並把（跨縣市的）取貨點指派到路線、於路線內拖拉排序。

**Independent Test**: 新增「A 線」→ 同名被拒 → 改名 → 指派多個跨縣市取貨點 → 路線內排序保留 → 擋刪（有取貨點）→ 移除後刪除成功；全程不需訂單資料。

### Implementation for User Story 1

- [X] T003 [P] [US1] 新增 `app/lib/routes.ts`：`getRoutes`（`unstable_cache`，tag `"routes"`，含取貨點計數，`ORDER BY id`）、`addRoute`、`renameRoute`、`deleteRoute`、`countSpotsInRoute`，比照 `app/lib/categories.ts`
- [X] T004 [P] [US1] 修改 `app/lib/validation.ts`：`MAX_LEN` 加 `routeName: 50`；新增 `parseRouteId`（null/正整數）。`validatePickupReorderBody` 維持 `{ city, ids }`（排序仍以縣市分群，供前台選點）
- [X] T005 [US1] 修改 `app/lib/pickup-spots.ts`：`PickupSpotRow` 加 `routeId/routeName`；`getPickupSpots` LEFT JOIN `routes`，`ORDER BY city, sort_order, id`（排序維持以縣市分群，供前台選點）；`addPickupSpot(city, township, routeId)` 之 `sort_order` 取該縣市 `MAX+1`、route_id 為附加屬性；`updatePickupSpot(id, township, routeId)` 只改 township 與 route_id（不動 sort_order）；`reorderPickupSpots(city, ids)` 維持 `WHERE p.city = ${city}`
- [X] T006 [P] [US1] 新增 `app/api/routes/route.ts`：`GET`（回 `RouteRow[]`）、`POST`（name 必填/trim/≤50；23505→「路線名稱重複」；`revalidateCache("routes")`），比照 `app/api/categories/route.ts`
- [X] T007 [P] [US1] 新增 `app/api/routes/[id]/route.ts`：`PUT`（改名，`parseId`，同名驗證，成功後 `revalidateCache("routes")` + `revalidateCache("pickup-spots")`）、`DELETE`（`countSpotsInRoute>0` 回 400「此路線仍有 N 個取貨點，無法刪除」；23503 同類訊息），比照 `app/api/categories/[id]/route.ts`
- [X] T008 [US1] 修改 `app/api/pickup-spots/route.ts`：`POST` body 接受 `routeId?: number | null` 並傳入 `addPickupSpot`
- [X] T009 [US1] 修改 `app/api/pickup-spots/[id]/route.ts`：`PUT` body `township` 必填；**僅當含 `routeId` 欄位才更新路線**（`updatePickupSpot`），否則只改地點（`updatePickupSpotTownship`，route 不動）；維持 `PickupSpotDuplicateError`(23505)→409
- [X] T010 [US1] `app/api/pickup-spots/reorder/route.ts`：維持 `validatePickupReorderBody`（`{ city, ids }`），呼叫 `reorderPickupSpots(parsed.value.city, parsed.value.ids)`（排序維持以縣市分群）
- [X] T011 [P] [US1] 新增 `app/(admin)/routes/page.tsx`（`"use client"`，antd v6）：路線清單/新增/改名/刪除（擋刪錯誤透傳）；「自取點」欄以 **Tag** 列出各路線（及「未分路線」虛擬列）底下自取點；編輯 modal 可改名＋以**多選**指派本路線自取點（屬其他路線者停用＝不可重複選取），存檔時 diff 新增/移除並逐一 PUT `/api/pickup-spots/[id]` 帶 `{ township, routeId|null }`
- [X] T012 [US1] 修改 `app/(admin)/pickup-spots/page.tsx`：**維持既有縣市 tab 與縣市內 DnD 拖拉排序（前台顧客選點用，送出 `{ city, ids }`）**；列表加「所屬路線」欄（**唯讀**）；modal **不含**路線指派（PUT 只送 `{ township }`，路線於「路線管理」頁調整）

**Checkpoint**: 路線可被建立/維護，取貨點可歸屬路線並於路線內排序、擋刪生效（驗收 1、2、6 之歸屬部分）。

---

## Phase 4: User Story 2 - 路線訂單統計與結單 (Priority: P1)

**Goal**: 選一條路線即見「各取貨點 × 各商品」數量交叉表＋商品總量、可匯出統計 CSV；以整條路線為單位結單匯出一份涵蓋線上所有取貨點訂單的 CSV，下載成功後才清除。

**Independent Test**: 在已有路線/歸屬取貨點/訂單下，選路線看統計交叉表與總量、匯出統計 CSV；對該路線結單下載一份 CSV（含各取貨點區分）、確認下載成功後訂單被清除、下載失敗不清除；「未分路線」「宅配」各自可結單。

### Implementation for User Story 2

- [X] T013 [US2] 修改 `app/lib/orders.ts`（第一批）：`OrderRow` 加 `routeId/routeName`（經 `orders→pickup_spots→routes` 即時 JOIN）；`assembleOrders` 與各 SELECT 帶出 route 欄位；新增 `getOrderRoutes()`（回有自取訂單的路線 `{id,name}[]` ＋ `hasUnassigned` ＋ `hasDelivery`，供 US3 訂單篩選下拉）；新增 `getRouteOrderMatrix(route: number | "unassigned" | "all", from: string, to: string)` 與 `RouteOrderMatrix` 型別：日期以 `(o.created_at AT TIME ZONE 'Asia/Taipei')::date BETWEEN ${from} AND ${to}` 參數化過濾；`route` 三態（指定 id / 未分路線 `IS NOT DISTINCT FROM NULL` / `all` 不加 route 條件）；列＝取貨點 city+township，`all` 時 `ORDER BY route_id NULLS LAST, sort_order, ps.id`，單一路線時依 `sort_order`；欄＝商品數量、**欄序依 `products.sort_order`**（LEFT JOIN products；已刪商品排最後）；附 `productTotals`（只列範圍內有訂單的取貨點）
- [X] T014 [US2] 修改 `app/lib/orders.ts`（第二批，續 T013 同檔）：`getCloseGroups()` 改以 route 聚合（每條有自取訂單的路線一組 ＋ 未分路線 `route:∅` ＋ 宅配）；`CloseGroupSummary` 以 `routeId` 取代 `pickupSpotId`；`deleteOrdersByGroup(method, routeId?: number | null)` 自取改刪 `pickup_spot_id IN (SELECT id FROM pickup_spots WHERE route_id IS NOT DISTINCT FROM ${routeId})`
- [X] T015 [US2] 修改 `app/api/orders/summary/route.ts`：無 `route` 且無 `from`/`to` 時回 `{ routes }`（來源 `getRoutes()`＝全部路線，供下拉）；統計查詢接受 `route`（`<id>`/`unassigned`/`all` 或省略）＋ `from`/`to`（`YYYY-MM-DD`），呼叫 `getRouteOrderMatrix(route, from, to)`；未給有效 route 且未給日期 → 400「請至少指定路線或日期」；移除 `city` 路徑
- [X] T016 [US2] 修改 `app/api/orders/close/route.ts`：`GET` 回 route 分組；`POST` body 改 `{ method?, routeId?: number | null }`，`filterGroup` 以訂單 `routeId` 比對，CSV「取貨地點」欄自取輸出**縣市+地點**（`pickupSpotLabel`，跨縣市同名鄉鎮亦可區分）、宅配輸出地址、檔名帶路線名/未分路線/宅配；`DELETE` 改傳 `routeId`
- [X] T017 [US2] 修改 `app/(admin)/order-summary/page.tsx`：標題改「路線訂單統計」；路線下拉改為「全部路線 / 各路線 / 未分路線」（來源 `GET /api/orders/summary` 之 `getRoutes` 全部路線）＋日期區間（起、訖兩欄，預設皆今天，台北時區）；查詢帶 `route`+`from`+`to`；交叉表列改為取貨點（city+township），保留商品總量列；無訂單時顯示空表、清空日期且未選路線時提示；CSV 匯出反映目前條件
- [X] T018 [US2] 修改 `app/(admin)/orders/page.tsx`（結單視窗部分）：可結單分組改以路線列出（＋未分路線＋宅配），兩階段流程不變（POST 下載成功後才 DELETE），DELETE body 改傳 `{ method, routeId }`

**Checkpoint**: 路線統計與路線結單可運作（驗收 3、5、6 之統計/結單部分）。

---

## Phase 5: User Story 3 - 以路線篩選訂單管理 (Priority: P2)

**Goal**: 訂單管理頁以路線（含「未分路線」「宅配」）為主要篩選維度列出訂單，明細展開與結果內文字搜尋行為不變。

**Independent Test**: 切換不同路線（含未分路線、宅配）篩選，確認只列出對應訂單；明細展開與文字搜尋如舊。

### Implementation for User Story 3

- [X] T019 [US3] 修改 `app/lib/orders.ts`（續同檔，依賴 T013 的 route 欄位）：以 `getOrdersByRoute(routeId: number | null)` 取代 `getOrdersByLocation`（自取訂單依路線，null=未分路線）；移除/淘汰 `getOrderLocations`、`getOrderCities`、`getCityOrderMatrix`（改用 `getOrderRoutes`/`getRouteOrderMatrix`）
- [X] T020 [US3] 修改 `app/api/orders/route.ts`：`GET` 無參數回 `{ routes, hasUnassigned, hasDelivery }`；`?method=delivery` 回宅配訂單；`?route=<id>` / `?route=unassigned` 回 `getOrdersByRoute`；移除 `city`/`township` 參數；POST 不變
- [X] T021 [US3] 修改 `app/(admin)/orders/page.tsx`（篩選部分）：篩選下拉改以路線（含未分路線、宅配）為維度，串接新 `GET /api/orders`；保留明細展開與結果內文字搜尋

**Checkpoint**: 訂單管理可用路線篩選（驗收 4）。

---

## Phase 6: User Story 4 - 導覽與文案 (Priority: P3)

**Goal**: 側邊欄新增「路線管理」入口；「縣市訂單統計」更名「路線訂單統計」，相關縣市文案改路線。

**Independent Test**: 側邊欄出現可進入的「路線管理」；統計選單與頁面標題顯示「路線訂單統計」。

### Implementation for User Story 4

- [X] T022 [P] [US4] 修改 `app/components/admin-shell.tsx`：`menuItems` 在「自取點管理」附近加 `{ key: "/routes", label: "路線管理" }`（選合適 antd icon）；將 `/order-summary` 的 label「縣市訂單統計」改為「路線訂單統計」
- [X] T023 [US4] 巡檢 `app/(admin)/orders/page.tsx`、`app/(admin)/order-summary/page.tsx` 等殘留以縣市為主之 UI 文案（如「選擇縣市」），改為路線用語（zh-TW）

**Checkpoint**: 導覽與文案一致（驗收之 R6）。

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 收尾驗證。

- [X] T024 [P] 執行 `npm run lint` 並修正所有問題
- [X] T025 [P] 執行 `npm run build` 確認 TS strict 型別與建置通過
- [X] T026 依 `specs/004-delivery-route-grouping/quickstart.md` 流程 A–F 手動驗收（對應 spec 驗收 1–6 / SC-001~007）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 無相依，可立即開始。
- **Foundational (Phase 2)**: 依賴 T001；**阻擋所有 user story**。
- **User Stories (Phase 3–6)**: 皆依賴 Phase 2 完成。US1 與 US2 同為 P1；US3 依賴 US2 對 `orders.ts` 的 route 欄位（T013）；US4 可獨立。
- **Polish (Phase 7)**: 依賴欲交付的 story 完成。

### User Story Dependencies

- **US1 (P1)**: 僅依賴 Foundational。獨立可測（不需訂單）。
- **US2 (P1)**: 依賴 Foundational；T013 引入 `OrderRow.routeId` 為 US3 共用基礎。
- **US3 (P2)**: 依賴 Foundational；`orders.ts` 的 route 欄位（T013）需先就位，故 T019 排在 T013 之後。
- **US4 (P3)**: 依賴 Foundational；`/routes` 連結需 US1 的 routes 頁存在才有意義（建議 US1 後）。

### 同檔序列化（非 [P]）

- `app/lib/orders.ts`：T013 → T014 → T019（同檔，依序）。
- `app/(admin)/orders/page.tsx`：T018（結單視窗）→ T021（篩選）→ T023（文案），同檔依序。
- `app/lib/pickup-spots.ts`：T005 單一任務。

### Within Each User Story

- 資料層（lib）→ API（route）→ 頁面（page）。
- US1：T003/T004（[P]）→ T005 → T006/T007（[P]，依賴 T003）→ T008/T009/T010（依賴 T004/T005）→ T011（[P]，依賴 T006/T007）→ T012（依賴 T008/T009/T010 + T003）。

### Parallel Opportunities

- Setup 內無 [P]（單一任務）。
- US1 起手可平行：T003、T004 同時；隨後 T006、T007 同時；T011 與 API 任務可平行於不同檔。
- 跨 story：Foundational 完成後，US1 與 US2 可由不同人平行（不同檔，惟 `orders/page.tsx` 之 US2/US3 部分需協調）。
- US4 之 T022（`admin-shell.tsx`）與其他 story 不同檔，可隨時平行。
- Polish 之 T024、T025 可平行。

---

## Parallel Example: User Story 1

```bash
# 起手平行（不同檔）：
Task: "新增 app/lib/routes.ts（routes 資料層）"            # T003
Task: "修改 app/lib/validation.ts（routeName + reorder）"  # T004

# 路線 API 平行（皆依賴 T003）：
Task: "新增 app/api/routes/route.ts（GET/POST）"           # T006
Task: "新增 app/api/routes/[id]/route.ts（PUT/DELETE）"    # T007
```

---

## Implementation Strategy

### MVP First

1. Phase 1 Setup（T001）→ Phase 2 Foundational（T002）。
2. Phase 3 US1（路線管理 + 取貨點歸屬）→ **STOP & VALIDATE**：可建立路線、指派跨縣市取貨點、擋刪。此為功能骨幹（驗收 1、2、6 歸屬部分）。
3. Phase 4 US2（統計 + 結單）→ 完成 P1 的核心產出（備貨/出貨對齊，驗收 3、5）。

> 註：US1 與 US2 同為 P1。US1 為可獨立 demo 的最小骨幹；US2 為「讓功能對使用者產生實際出貨價值」的 P1 補完。建議連續完成 US1+US2 作為首個可上線增量。

### Incremental Delivery

1. Setup + Foundational → DB 就緒。
2. US1 → 獨立驗收（路線/歸屬）→ demo。
3. US2 → 獨立驗收（統計/結單）→ demo。
4. US3 → 獨立驗收（訂單篩選）→ demo。
5. US4 → 導覽/文案收尾。
6. Polish（lint/build/quickstart）。

---

## Notes

- [P] = 不同檔、無相依。
- [Story] 標籤對應 spec user story，利於追溯。
- 每個 story 應可獨立完成與驗收。
- 任何寫入 DB 的 API 後均需 `revalidateCache(tag)` 同步前台（routes 改名同時 revalidate `routes` 與 `pickup-spots`）。
- 嚴守憲法：SQL 一律經 `sql` tagged template 參數化；不更動 `orders`/`order_items` 既有列；前台選點與 `pickup_number` 規則不變。
- 每完成一個任務或邏輯群組即 commit。
