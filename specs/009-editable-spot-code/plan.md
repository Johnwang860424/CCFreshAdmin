# Implementation Plan: 站點代碼改為可維護欄位（取貨號碼前綴）

**Branch**: `feature/editable-spot-code` | **Date**: 2026-07-11（rev. 依路線重編回填） | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-editable-spot-code/spec.md`

## Summary

取貨號碼前綴（英文部分）由「`pickup_spot_id` 換算」改為 **`pickup_spots.code` 儲存欄位**（1–3 大寫英文字母、**同路線內唯一**、管理員可維護）。Migration `006` 加欄位並**依路線重編回填**：同 `route_id` 內按 `id` 順序編 A、B、C…（`row_number()` 轉 Excel 式字母），每路線自 A 起算、未分路線（NULL）自成一組；既有訂單前綴隨之改變（放棄零感，使用者裁決）。唯一鍵為 `UNIQUE NULLS NOT DISTINCT (route_id, code)`。訂單查詢 JOIN 帶出 `spot_code`，`formatPickupCode` 改吃代碼字串；`spotCodeFromId` 移除。自取點管理頁表單新增代碼欄；站點尚有訂單時改代碼採「兩段式 PUT + 確認」；**改分路線撞碼**（路線管理頁）由同一唯一鍵擋下、回明確 409。宅配與顧客端 App 完全不動。

## Technical Context

**Language/Version**: TypeScript（strict）/ Next.js 16.2.4 / React 19

**Primary Dependencies**: antd v6（自取點管理、訂單頁 UI）、xlsx（匯出）、`@neondatabase/serverless`

**Storage**: Neon Postgres — migration `db/migrations/006_add_pickup_spot_code.sql`：`pickup_spots.code TEXT NOT NULL` + `CHECK (code ~ '^[A-Z]{1,3}$')` + `UNIQUE NULLS NOT DISTINCT (route_id, code)`（PG15+，`orders` 已用同語法），含依路線 `row_number()` 回填；`db/schema.sql` 同步補上欄位（憲法 Development Workflow）

**Testing**: 無測試框架（憲法）；`npm run lint`、`npm run build` + quickstart.md 手動驗證

**Target Platform**: Vercel／Node server（既有部署），管理後台瀏覽器

**Project Type**: Next.js App Router web app（既有單一專案）

**Performance Goals**: 無新增負載——訂單查詢原本就 JOIN `pickup_spots`，僅多帶一欄；代碼組合為純字串串接

**Constraints**: UI zh-TW；顧客端 App 寫入路徑不可變（FR-010，欄位為 additive）；上線回填會改變既有訂單前綴（FR-005，使用者已接受）；`pickup_number` 指派規則與唯一鍵不動

**Scale/Scope**: 站點數十個；異動 ≈ 1 migration + 4 個 lib/API 檔 + 2 個頁面 + 匯出模組（路線管理頁僅靠 API 錯誤訊息，預期零改動）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | 評估 | 結果 |
|---|-----------|------|------|
| I | Read the Bundled Docs | 不觸及 routing/proxy/server-client 邊界；沿用既有 client page 與 lib 模式 | PASS |
| II | Parameterized SQL Only | 新增/修改查詢全走 `sql` tagged template，集中於 `app/lib/pickup-spots.ts`、`app/lib/orders.ts`；代碼值一律參數化 | PASS |
| III | Deny-by-Default Authorization | 無新端點（沿用 pickup-spots GET/POST/PUT）；既有授權與 proxy matcher 不變 | PASS |
| IV | No Orphaned Images | 不涉及圖片 | PASS |
| V | Orders Mutable Until Shipment | 不改訂單寫入/指派/出貨；取貨號仍為即時組合顯示、不快照；`ON DELETE RESTRICT` 鏈不變 | PASS |
| — | Technology Constraints | zh-TW 文案；改動頁面已是 `"use client"`；schema 變更同步 `db/schema.sql` 並於 PR 說明遷移步驟 | PASS |

**Post-Phase-1 re-check**: 全數 PASS（欄位 additive、驗證雙層〔DB CHECK/UNIQUE + API〕、無新端點）。

## Project Structure

### Documentation (this feature)

```text
specs/009-editable-spot-code/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── spot-code.md     # 欄位/驗證/兩段式確認/顯示組合契約
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
db/
├── schema.sql                        # 修改：pickup_spots 補 code 欄（CHECK + UNIQUE NULLS NOT DISTINCT (route_id, code)）
└── migrations/
    └── 006_add_pickup_spot_code.sql  # 新增：加欄位 + 依路線 row_number() 回填 + NOT NULL/CHECK/UNIQUE

app/
├── lib/
│   ├── pickup-spots.ts       # 修改：PickupSpotRow.code、add/update 帶 code、
│   │                         #        SpotCodeDuplicateError（依 constraint 名分流 23505，
│   │                         #        新增/改碼/改分路線三種寫入路徑共用）、countOrdersBySpot
│   ├── orders.ts             # 修改：OrderRow.spotCode；getOrders / getOrdersByIds /
│   │                         #        getOrdersByRoute / getDeliveryOrders / getOrderById 帶 ps.code
│   ├── pickup-code.ts        # 修改：formatPickupCode(spotCode, pickupNumber)；刪 spotCodeFromId
│   ├── order-export.ts       # 修改：orderToRow 改用 order.spotCode
│   └── validation.ts         # 修改：新增 parseSpotCode（trim、轉大寫、^[A-Z]{1,3}$）
├── api/
│   └── pickup-spots/
│       ├── route.ts          # 修改：POST 必填 code、驗證、409 同路線代碼重複
│       └── [id]/route.ts     # 修改：PUT 接受 code（兩段式確認）；改分路線撞碼 → 409 明確訊息
└── (admin)/
    ├── pickup-spots/page.tsx # 修改：表格顯示代碼欄；新增/編輯表單含代碼欄位；改碼確認 Modal
    ├── routes/page.tsx       # 預期零改動：改分路線撞碼由 API 409 訊息呈現（既有錯誤顯示機制）
    └── orders/page.tsx       # 修改：取貨號 render/搜尋改用 order.spotCode
```

**Structure Decision**: 沿用既有單一專案結構與「一實體一資料模組」慣例。代碼的讀寫集中在 `pickup-spots.ts`；訂單側只是 JOIN 多帶一欄。`pickup-code.ts` 保留為顯示組合的唯一入口（訂單頁與匯出共用），確保三處顯示一致（SC-001）。

## Complexity Tracking

無憲法違規，無需填寫。

## Design Notes（關鍵決策摘要，詳見 research.md）

- **D1 欄位與約束**：`code TEXT NOT NULL`、`CHECK (code ~ '^[A-Z]{1,3}$')`、`UNIQUE NULLS NOT DISTINCT (route_id, code)`（未分路線 NULL 群組也強制唯一；PG15+，`orders` 表已用同語法）；一律大寫儲存。
- **D2 回填（依路線重編）**：`row_number() OVER (PARTITION BY route_id ORDER BY id)` → Excel 式字母（1→A…27→AA）；每路線自 A 起算、NULL 路線自成一組；既有訂單前綴隨之改變（使用者裁決，放棄零感）。
- **D3 顯示來源**：`OrderRow.spotCode`（JOIN `pickup_spots.code`）；`formatPickupCode` 改吃字串；`spotCodeFromId` 刪除。
- **D4 改碼確認**：PUT 未帶 `confirmCodeChange` 且代碼有變、站點有訂單 → 回 409 + `requiresConfirmation: true`；前端 Modal 確認後重送。訂單數以 DB 即時查詢為準（不吃快取）。
- **D5 錯誤分流**：SQLSTATE 23505 依 constraint 名分流——`(city, township)` → 既有訊息；`(route_id, code)` → 「同路線已有相同代碼的站點」。同一分流同時涵蓋新增、改碼、**改分路線**（路線管理頁 `updatePickupSpot` 移動站點撞碼時由同一唯一鍵擋下，FR-008），路線頁前端零改動。
- **D6 顧客端相容**：欄位 additive、`pickup_number` 寫入約定不動；顧客端 App 無感（FR-010）。
