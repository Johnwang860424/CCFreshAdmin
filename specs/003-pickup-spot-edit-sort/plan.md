# Implementation Plan: 自取點編輯與排序 (Pickup Spot Edit & Sorting)

**Branch**: `003-pickup-spot-edit-sort` | **Date**: 2026-06-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-pickup-spot-edit-sort/spec.md`

## Summary

為自取點管理頁新增兩項能力：(1) 編輯既有自取點的地點名稱（township，city 唯讀）；(2) 同縣市內拖拉排序——清單以縣市分組，拖拉僅限同縣市群組內，縣市間順序沿用既有固定序（`TAIWAN_LOCATIONS`）。技術上完全沿用 `001-product-sorting` 的既有模式（dnd-kit 拖拉把手、樂觀更新、進入排序模式清空搜尋與分頁、`unnest WITH ORDINALITY` 單語句原子重寫），差異僅在於**排序鍵以縣市分群**：`pickup_spots` 新增 `sort_order INTEGER NOT NULL`，語意為「同縣市內的相對順序」，以一次性 migration 依各縣市既有建立序（id）回填。

## Technical Context

**Language/Version**: TypeScript strict, React 19, Next.js 16.2.4 (App Router)

**Primary Dependencies**: antd v6、`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/modifiers`（已用於商品排序）、`@neondatabase/serverless`（raw SQL tagged template）

**Storage**: Neon Postgres。`pickup_spots` 既有表，新增 `sort_order` 欄；既有資料以 migration 回填

**Testing**: 無測試框架；以 `npm run lint` + `npm run build`（型別檢查）+ 手動驗證為準

**Target Platform**: Web（管理後台，zh-TW）

**Project Type**: Web application（Next.js 單一專案，App Router）

**Performance Goals**: 拖放後 1 秒內見到新順序（樂觀更新即時）；自取點數量級為數十至數百筆

**Constraints**: Neon serverless HTTP 驅動無互動式交易 → 每縣市重排須為**單一 SQL 語句**達原子性；所有 SQL 走 `sql` tagged template 自動參數化

**Scale/Scope**: 低併發（少數管理員），併發以後寫覆蓋處理；單頁功能，無新頁面

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Read the Bundled Docs Before Writing Framework Code** — 不新增/變更 routing、proxy、server/client 邊界或資料抓取機制；沿用既有 `app/api/...` route handler 與 `"use client"` 頁面模式。無新框架面向決策。✅ PASS
- **II. Parameterized SQL Only (NON-NEGOTIABLE)** — 所有新查詢（`updatePickupSpotTownship`、`reorderPickupSpots`、`addPickupSpot` 改版）皆寫在 `app/lib/pickup-spots.ts`，以 `sql` tagged template 參數化；`city`/`township`/`ids` 皆為內插值，不字串拼接。✅ PASS
- **III. Deny-by-Default Authorization** — 沿用既有 proxy matcher；新增的 reorder / edit 變更端點屬 mutating，沿用 `jsonHandler` 既有模式（與商品 reorder/edit 一致）。不放寬任何授權。✅ PASS
- **IV. No Orphaned Images** — 本功能不涉及 Cloudinary 影像。✅ N/A
- **V. Order History Is Immutable** — 不修改 `orders`/`order_items`；`pickup_spots` 編輯僅改 township，不影響訂單快照（訂單已快照 pickup spot 名稱於自身列）。刪除仍受既有 `ON DELETE RESTRICT` 保護。✅ PASS
- **Technology Constraints** — 頁面維持 `"use client"`（用 antd 複合靜態）；`sort_order` 為 `INTEGER`；identity 仍為 serial `id`（`rowKey="id"`）。✅ PASS
- **Development Workflow（Schema changes）** — Schema 變更同時更新 `db/schema.sql` 並提供 `db/migrations/003_*.sql`，PR 說明 migration 步驟。✅ PASS

**Result**: 無違規，無需 Complexity Tracking。Re-check 後（Phase 1 設計）維持 PASS。

## Project Structure

### Documentation (this feature)

```text
specs/003-pickup-spot-edit-sort/
├── plan.md              # 本檔
├── research.md          # Phase 0：決策與理由
├── data-model.md        # Phase 1：pickup_spots 欄位/migration/資料層介面
├── quickstart.md        # Phase 1：手動驗證腳本
├── contracts/           # Phase 1：API 合約
│   ├── pickup-spots-reorder.md
│   └── pickup-spots-edit.md
└── tasks.md             # Phase 2（/speckit-tasks 產生，非本指令）
```

### Source Code (repository root)

```text
db/
├── schema.sql                              # 新環境：pickup_spots 加 sort_order 欄 + index
└── migrations/
    └── 003_add_pickup_spot_sort_order.sql  # 既有環境：加欄、依縣市分群回填、設 NOT NULL、建 index

app/
├── lib/
│   ├── pickup-spots.ts                     # 加 sortOrder、getPickupSpots 改排序、addPickupSpot 改 MAX+1（per city）、
│   │                                       #   updatePickupSpotTownship、reorderPickupSpots、PickupSpotDuplicateError
│   └── validation.ts                       # 加 pickup reorder（city+ids）與 township 驗證輔助
├── api/
│   └── pickup-spots/
│       ├── reorder/route.ts                # 新增 PUT：依某縣市的 ids 重寫 sort_order
│       └── [id]/route.ts                   # 加 PUT：編輯 township
└── (admin)/
    └── pickup-spots/page.tsx               # 排序模式（分縣市群組拖拉）、編輯 Modal、SortableRow/DragHandle
```

**Structure Decision**: 沿用既有 Next.js App Router 單一專案結構與既有檔案位置。新增 `app/api/pickup-spots/reorder/route.ts`（鏡射 `app/api/products/reorder/route.ts`），其餘皆在既有檔案內擴充。排序 UI 元件（`DragHandle`、`SortableRow`、`RowContext`）在 `pickup-spots/page.tsx` 內以與商品頁相同方式定義（不抽共用元件，沿用現況、降低耦合風險；若日後第三處需要再抽出）。

## Complexity Tracking

> 無 Constitution 違規，無需填寫。
