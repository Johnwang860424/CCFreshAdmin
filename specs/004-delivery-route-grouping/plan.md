# Implementation Plan: 後台依「送貨路線」分組（取代縣市分組）

**Branch**: `004-delivery-route-grouping` | **Date**: 2026-06-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-delivery-route-grouping/spec.md`

## Summary

把後台三大訂單作業（訂單統計、結單匯出、訂單管理篩選）的主分組維度從「縣市/鄉鎮」改為「送貨路線」，縣市/鄉鎮退為取貨點顯示資訊。新增獨立 `routes` 表與側邊欄「路線管理」頁（新增/改名/刪除，名稱唯一，仍有取貨點時 `ON DELETE RESTRICT` 擋刪）；`pickup_spots` 加 `route_id`（可 NULL = 未分路線）作為後台分組屬性。**自取點管理頁維持既有以「縣市」分 tab 與縣市內拖拉排序（`sort_order` 不變）——該排序供前台顧客選取貨點使用；route 僅在新增/編輯 modal 以下拉指派。**訂單透過其取貨點即時關聯到路線；「宅配」與「未分路線」為兩個內建分組。**訂單統計另支援「路線 + 日期區間」查詢（兩者擇一必填，日期區間以台北時區比對 `created_at`、預設起＝訖＝今天；未選路線時跨路線列出區間內所有有訂單的取貨點，依 `sort_order` 排序）。** 沿用既有資料層（Neon serverless tagged-template + `unstable_cache`/cache tag）、API（`jsonHandler` / `revalidateCache` / `parseId`）與 antd v6 client 頁面模式，比照現有 `categories` 模組落地。

## Technical Context

**Language/Version**: TypeScript (strict), React 19, Next.js 16.2.4 (App Router)

**Primary Dependencies**: antd v6（`@ant-design/nextjs-registry`）、NextAuth v5（Auth.js beta）、`@neondatabase/serverless`、`@dnd-kit/*`（既有拖拉排序）

**Storage**: Neon Postgres，raw SQL 經 `app/lib/db.ts` 的 `sql` tagged template（自動參數化）

**Testing**: 無測試框架；以 `npm run lint` + `npm run build`（型別檢查）+ 手動驗證（quickstart.md）

**Target Platform**: Vercel 部署的 Next.js web app（後台管理）

**Project Type**: Web app（單一 Next.js App Router 專案；前後端同 repo，前台顧客端 App 在別 repo）

**Performance Goals**: 後台管理流量，無特別效能門檻；統計/結單以 SQL 聚合避免載入全量明細

**Constraints**: UI 一律 zh-TW；antd v6 compound statics 需 `"use client"`；禁止字串拼接使用者輸入進 SQL；寫入後 `revalidateCache(tag)` 同步前台；前台選點與訂單寫入機制（含 `pickup_number` 規則）不可變

**Scale/Scope**: 1 張新表、1 個欄位 migration、1 個新資料層模組、1 組新 API（routes）、4 個既有 API 調整、1 個新頁面、4 個既有頁面/元件調整

## Constitution Check

*GATE: 對照 `.specify/memory/constitution.md` v1.1.1。*

- **I. Read the Bundled Docs Before Writing Framework Code** — ✅ 本功能不新增/變更 routing 慣例、`proxy.ts` 中介層或 server/client 邊界模型；新頁面與 API 皆複製既有同類檔案（`categories`）的既驗證模式。若途中需動到框架層慣例，先讀 `node_modules/next/dist/docs/`。
- **II. Parameterized SQL Only (NON-NEGOTIABLE)** — ✅ 所有新查詢經 `sql` tagged template；route 分組以 `route_id`（int 或 NULL）參數化，NULL 比較用 `IS NOT DISTINCT FROM`，集合用 `= ANY(...)`/子查詢，絕不字串拼接。
- **III. Deny-by-Default Authorization** — ✅ 新頁面落在 `app/(admin)/` 受 server-side 守衛；新 `/api/routes/*` 由 `proxy.ts` 涵蓋。`proxy.ts` 以 `auth()` 包裹整體並對未登入的 `/api/*` 直接回 **401**（matcher `"/((?!api/auth|_next/static|_next/image|favicon.ico).*)"` 已含 `/api/routes`），故 deny-by-default 由中介層實際強制。決議：本功能沿用此中介層強制（不另於各 handler 加 `auth()`），與全 repo 一致。
- **IV. No Orphaned Images** — ✅ 不涉及 Cloudinary 影像生命週期。
- **V. Order History Is Immutable** — ✅ 本功能對 `orders`/`order_items` 僅讀取、匯出、結單清除（既有允許行為）；不編輯既有列、不改快照欄位。路線歸屬透過取貨點即時 JOIN，不寫入訂單列、無歷史快照需求（符合 spec 假設）。Migration 僅 `ALTER TABLE pickup_spots ADD COLUMN`，不動訂單資料。

**結論**：通過。授權由 `proxy.ts` 中介層對 `/api/*` 強制 401（決議採用），不另開偏差。

## Project Structure

### Documentation (this feature)

```text
specs/004-delivery-route-grouping/
├── plan.md              # 本檔
├── research.md          # Phase 0：設計決策
├── data-model.md        # Phase 1：schema 與資料層型別
├── quickstart.md        # Phase 1：驗證腳本
├── contracts/
│   └── api.md           # Phase 1：API 合約（routes 新增 + 既有調整）
└── checklists/
    └── requirements.md  # /speckit-specify 產出
```

### Source Code (repository root)

```text
db/
└── schema.sql                       # [改] 新增 routes 表、pickup_spots.route_id；補 migration 區塊

app/lib/
├── routes.ts                        # [新] getRoutes/addRoute/renameRoute/deleteRoute/countSpotsInRoute（比照 categories.ts）
├── pickup-spots.ts                  # [改] PickupSpotRow 加 routeId/routeName；JOIN routes；新增/更新收 routeId（sort_order/reorder 維持以縣市分群不變）
├── orders.ts                        # [改] OrderRow 加 routeId/routeName；getOrdersByRoute / getOrderRoutes / getRouteOrderMatrix(route, from, to) / getCloseGroups(by route) / deleteOrdersByGroup(by route)
└── validation.ts                    # [改] validatePickupReorderBody 改用 routeId；新增 route 名稱長度上限

app/api/
├── routes/
│   ├── route.ts                     # [新] GET（列表含計數）/POST（新增）
│   └── [id]/route.ts                # [新] PUT（改名）/DELETE（擋刪有取貨點者）
├── pickup-spots/
│   ├── route.ts                     # [改] POST 收 routeId
│   ├── [id]/route.ts                # [改] PUT 收 routeId（改派路線→重排 sort_order 至新路線尾）
│   └── reorder/route.ts             # [改] body 改 { routeId, ids }
└── orders/
    ├── route.ts                     # [改] GET 以 route 取代 city/township
    ├── close/route.ts               # [改] 結單分組改 routeId；filterGroup/CSV/DELETE 改路線
    └── summary/route.ts             # [改] GET 以 route 取代 city

app/(admin)/
├── routes/page.tsx                  # [新] 路線管理：路線增/改名/刪；「自取點」欄以 Tag 列出各路線（與「未分路線」虛擬列）底下自取點；編輯 modal 可改名＋以多選指派本路線自取點（屬其他路線者停用，避免重複選取）
├── pickup-spots/page.tsx            # [改] 維持縣市 tab 與縣市內拖拉排序（前台選點用）；列表顯示「所屬路線」欄（唯讀）；modal 僅編輯地點，不含路線指派（路線於「路線管理」頁調整）
├── order-summary/page.tsx           # [改] 標題「路線訂單統計」；下拉選路線（全部/各路線/未分路線，來源 getRoutes）＋日期區間（起訖預設今天）；交叉表列＝取貨點
└── orders/page.tsx                  # [改] 篩選下拉改路線；結單視窗改路線分組；縣市文案→路線

app/components/
└── admin-shell.tsx                  # [改] menu 加「路線管理」；「縣市訂單統計」→「路線訂單統計」
```

**Structure Decision**: 單一 Next.js App Router 專案，沿用既有「一實體一資料層模組 + 對應 REST route + `"use client"` 頁面」分層。`routes` 整組為 `categories` 的同構複製（含 cache tag、擋刪邏輯），降低新慣例與審查成本。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 新 `routes` 表（而非在 `pickup_spots` 直接放 route 文字） | 路線需可改名且名稱唯一、需擋刪（被取貨點引用時），並讓多取貨點共享同一路線實體 | 字串欄位無法保證唯一、改名要全表更新、無法 `ON DELETE RESTRICT` 擋刪 |
