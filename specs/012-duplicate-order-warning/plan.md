# Implementation Plan: 新增訂單重複下單警示

**Branch**: `feature/duplicate-order-filter`（實作時建議開 `feature/duplicate-order-warning`） | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-duplicate-order-warning/spec.md`

## Summary

後台「新增訂單」送出時，由**後端**檢查新訂單所屬路線分組（取貨點→路線；宅配、未分路線各為獨立分組）內是否已有同名（去頭尾空白後完全相符）訂單。採用本 repo 既有的**兩段式確認模式**（009 站點改碼同款）：`POST /api/orders` 未帶 `confirmDuplicate` 且偵測到同名 → 回 `409 { requiresConfirmation: true, duplicateCount, error: "系統偵測到您可能已有訂單。請確認是否為重複下單" }`，前端以 `modal.confirm` 顯示指定文字，管理員按「仍要建立」後帶 `confirmDuplicate: true` 重送、照常建立；按「取消」則停留在表單（內容保留）。無同名 → 直接建立，流程與現行完全相同。檢查為唯讀查詢（新函式 `countSameNameOrdersInGroup` 於 `app/lib/orders.ts`），零 schema 變更、零新端點。

## Technical Context

**Language/Version**: TypeScript（strict）/ Next.js 16.2.4 / React 19

**Primary Dependencies**: antd v6（`App.useApp()` 的 `modal.confirm`，頁面已是 `"use client"`）；Neon serverless（`sql` tagged template）

**Storage**: 零 schema 變更——僅新增一條唯讀 COUNT 查詢（orders JOIN pickup_spots，依 route_id 分組以 `customer_name` 完全相符比對）；不新增欄位、不落地任何標記

**Testing**: 無測試框架（憲法）；`npm run lint`、`npm run build` + quickstart.md 手動驗證

**Target Platform**: 既有部署（Vercel／Node server），管理後台瀏覽器

**Performance Goals**: 重複檢查為單條索引可用的 COUNT 查詢（母體＝單一分組的未出貨訂單，數十～數百筆），對新增訂單流程增加一次 DB 往返；無同名時無額外前端步驟（SC-001）

**Constraints**: 跳窗文字逐字固定（FR-003）；檢查母體＝系統中該分組全部現存訂單（含外部客購 App 寫入者），故必須在後端查 DB，不能只看前端已載入資料；警示為提示非封鎖（確認後一律可建立）；檢查與建立間存在 TOCTOU 空窗，spec 明載為可接受（盡力提示）

**Scale/Scope**: 異動 3 檔：`app/lib/orders.ts`（+1 查詢函式）、`app/api/orders/route.ts`（POST +檢查分支）、`app/(admin)/orders/page.tsx`（handleCreate 抽共用送出函式＋409 確認視窗）；無新檔案

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | 評估 | 結果 |
|---|-----------|------|------|
| I | Read the Bundled Docs | 不觸及 routing／proxy／server-client 邊界的新用法；沿用既有 Route Handler 與 client 元件模式 | PASS |
| II | Parameterized SQL Only | 新查詢寫在 `app/lib/orders.ts`，全程 `sql` tagged template 參數化；姓名、spotId 均為插值參數 | PASS |
| III | Deny-by-Default Authorization | 無新端點；`POST /api/orders` 既有 `jsonHandler` 授權包裝不變 | PASS |
| IV | No Orphaned Images | 不涉及圖片 | PASS |
| V | Orders Mutable Until Shipment | 檢查為唯讀、發生在 `createOrder` 之前；訂單寫入路徑（單 CTE 原子語句、快照、庫存扣減）完全不動 | PASS |
| — | Technology Constraints | zh-TW 文案（跳窗文字逐字沿用 spec）；`orders/page.tsx` 已 `"use client"`；identity 仍為 `id` | PASS |

**Post-Phase-1 re-check**: 全數 PASS（無 schema 變更、無新端點；409 契約為既有 009 模式的複用；`revalidateCache("products")` 僅在實際建立成功後呼叫，409 路徑不觸發）。

## Project Structure

### Documentation (this feature)

```text
specs/012-duplicate-order-warning/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── duplicate-order-check.md   # POST /api/orders 兩段式確認契約
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
app/
├── lib/orders.ts                # 修改：新增 countSameNameOrdersInGroup(...)
│                                #   pickup：CROSS JOIN target(route_id of spot)，
│                                #   ps.route_id IS NOT DISTINCT FROM target → 同分組
│                                #   （spot 不存在 → target 空 → 回 0，交由 createOrder 報錯）
│                                #   delivery：delivery_method='delivery' 全體
│                                #   比對：o.customer_name = ${trimmed name}（寫入端皆已 trim）
├── api/orders/route.ts          # 修改：POST 於 validateCreateOrderBody 之後、createOrder 之前，
│                                #   body.confirmDuplicate !== true 且 count>0
│                                #   → 409 { requiresConfirmation, duplicateCount, error }
└── (admin)/orders/page.tsx      # 修改：handleCreate 抽出 submitOrder(values, confirmDuplicate)
                                 #   catch ApiError 且 body.requiresConfirmation
                                 #   → modal.confirm（content=指定文字、okText 仍要建立）
                                 #   → onOk 帶 confirmDuplicate:true 重送，成功流程共用
                                 #   取消 → 關閉確認窗，新增表單與內容保留
```

**Structure Decision**: 檢查放後端（資料層新函式＋POST 前置檢查）而非前端已載入資料——spec 明定母體為「系統中該分組現存全部訂單」（含外部 App 寫入者），且新訂單的目標分組未必等於目前檢視中的路線視圖。互動採兩段式 409 確認，直接複用 009 站點改碼的既有契約與前端處理模式（`ApiError.body.requiresConfirmation`），零新架構。

## Complexity Tracking

無憲法違規，無需填寫。

## Design Notes（關鍵決策摘要，詳見 research.md）

- **D1 檢查位置**：後端兩段式（409 confirm→重送），非前端預查——母體正確性（含外部 App 訂單、跨視圖分組）只有 DB 查詢能保證；模式與 009 一致。
- **D2 分組與比對查詢**：`countSameNameOrdersInGroup({ customerName, deliveryMethod, pickupSpotId })`；pickup 以目標取貨點的 `route_id`（可為 NULL＝未分路線）`IS NOT DISTINCT FROM` 比對其他取貨訂單的路線；delivery 以 `delivery_method='delivery'` 為分組。姓名比對 `o.customer_name = ${name}` 完全相符（輸入端 `validateCreateOrderBody` 已 trim；資料庫值由各寫入端保證已 trim，不做 btrim）。
- **D3 confirmDuplicate 傳遞**：route handler 直接讀 `body.confirmDuplicate === true`（同 009 的 `confirmCodeChange`），`validation.ts` 與 `ValidatedCreateOrder` 不動。
- **D4 前端確認窗**：用頁面既有 `App.useApp()` 的 `modal.confirm`；`content` 逐字＝「系統偵測到您可能已有訂單。請確認是否為重複下單」（FR-003），`okText: "仍要建立"`、`cancelText: "取消"`；onOk 重送並共用成功流程（成功訊息、取貨號視窗、列表刷新——FR-004）。
- **D5 一次送出一次警示**：不論同名幾筆，COUNT>0 即回一次 409（FR-007）；`duplicateCount` 隨回應提供但跳窗文字不變。
- **D6 檢查順序**：400 驗證錯誤（含庫存不足等 OrderInputError）優先於重複檢查之後的建立；重複檢查僅在輸入驗證通過後執行，避免對無效請求做 DB 查詢；取貨點不存在時檢查回 0、由 `createOrder` 既有錯誤處理回報。
- **D7 唯讀與快取**：檢查不寫任何資料（FR-008）；409 提早 return，不觸發 `revalidateCache("products")`。
