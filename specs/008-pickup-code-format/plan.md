# Implementation Plan: 取貨號碼英數格式（站點代碼＋流水號）

**Branch**: `main`（未另開分支） | **Date**: 2026-07-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-pickup-code-format/spec.md`

## Summary

取貨號碼由純數字改為「站點代碼＋流水號」（如 A5），站點代碼由 `pickup_spot_id` 以 Excel 式雙射 26 進位固定換算（1→A…26→Z、27→AA），**純顯示層衍生、零儲存、零 schema/API 變更**。DB 的 `pickup_number` 指派規則、外部顧客端 App 寫入路徑完全不動；只改兩個顯示點（訂單管理頁欄位＋搜尋、xlsx 匯出欄）並新增一個共用純函式模組。宅配訂單維持現狀（自身序列純數字，無站點代碼）。

## Technical Context

**Language/Version**: TypeScript（strict）/ Next.js 16.2.4 / React 19

**Primary Dependencies**: antd v6（訂單頁 UI）、xlsx（匯出）、`@neondatabase/serverless`（本功能不新增查詢）

**Storage**: Neon Postgres — **本功能零 schema 變更、零 migration**；`orders.pickup_number` 仍為 INTEGER、`UNIQUE NULLS NOT DISTINCT (pickup_spot_id, pickup_number)` 不動

**Testing**: 無測試框架（憲法）；以 `npm run lint`、`npm run build` 與 quickstart.md 手動驗證

**Target Platform**: Vercel／Node server（既有部署），管理後台瀏覽器

**Project Type**: Next.js App Router web app（既有單一專案）

**Performance Goals**: 無新增負載——字母換算為 O(log₂₆ id) 純函式，於 render/export 時計算

**Constraints**: UI zh-TW；顯示層不得改動 DB 寫入路徑（顧客端 App 相容，FR-008）；字母僅可由不可變的 `pickup_spot_id` 衍生（不可用 sort_order，避免既有訂單號碼漂移）

**Scale/Scope**: 站點數十個、每檔訂單數百筆；異動範圍 ≈ 1 個新模組 + 2 個既有檔案

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | 評估 | 結果 |
|---|-----------|------|------|
| I | Read the Bundled Docs | 不觸及 routing/proxy/server-client 邊界等框架層；僅改既有 client page 與 lib 純函式 | PASS |
| II | Parameterized SQL Only | 零新 SQL；不改任何查詢 | PASS |
| III | Deny-by-Default Authorization | 零新端點；既有端點授權不變 | PASS |
| IV | No Orphaned Images | 不涉及圖片 | PASS |
| V | Orders Mutable Until Shipment | 不改訂單寫入／指派／出貨邏輯；`pickup_number` 指派與唯一鍵完全不動 | PASS |
| — | Technology Constraints | zh-TW 文案；`orders/page.tsx` 已是 `"use client"`；無 schema 變更故免更新 `db/schema.sql` | PASS |

**Post-Phase-1 re-check**: 設計後仍全數 PASS（純顯示層，無新增複雜度）。

## Project Structure

### Documentation (this feature)

```text
specs/008-pickup-code-format/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── pickup-code.md   # 換算/格式化契約（顯示與匯出共用）
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
app/
├── lib/
│   ├── pickup-code.ts        # 新增：spotCodeFromId / formatPickupCode 純函式（client/server 皆可用）
│   ├── order-export.ts       # 修改：orderToRow 的「取貨號」欄改用 formatPickupCode
│   └── orders.ts             # 不改邏輯；僅 OrderRow.pickupNumber 註解補充顯示規則（可選）
└── (admin)/
    └── orders/
        └── page.tsx          # 修改：取貨號欄 render、搜尋比對改用格式化後號碼
```

**Structure Decision**: 沿用既有單一 Next.js 專案結構。新邏輯集中於 `app/lib/pickup-code.ts`（無 React、無 SQL 的純函式模組），由 client（訂單頁）與 server（xlsx 匯出，經 `order-export.ts` 供 `orders/close` 與 `orders/selection` 兩端點共用）同時引用，保證三處顯示一致（SC-002）。

## Complexity Tracking

無憲法違規，無需填寫。

## Design Notes（關鍵決策摘要，詳見 research.md）

- **D1 字母換算**：Excel 式雙射 26 進位（1→A、26→Z、27→AA）。
- **D2 衍生位置**：顯示層（render／export builder）計算；API payload 已含 `pickupSpotId` + `pickupNumber`，零後端變更。
- **D3 宅配**：維持現狀純數字（現行程式已為宅配指派 NULL-spot 序列號並顯示）；不加代碼、不顯示「-」。
- **D4 搜尋**：以格式化後號碼做不分大小寫比對（輸入「a1」「A1」皆命中）；其餘搜尋欄位行為不變。
- **D5 既有訂單**：號碼為衍生呈現，上線即自動套用，無資料遷移。
