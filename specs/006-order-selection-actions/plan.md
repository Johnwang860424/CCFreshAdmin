# Implementation Plan: 訂單勾選出貨與匯出 CSV（跨頁選取）

**Branch**: `main`（本檔以 `specs/006-order-selection-actions` 為依據） | **Date**: 2026-07-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-order-selection-actions/spec.md`

## Summary

在訂單管理頁面（`orders/page.tsx`）為訂單表格加入列勾選（rowSelection），讓管理員對「目前選定路線視圖」中任意勾選的訂單一次執行兩種動作，並在同一路線的表格分頁間維持勾選：

1. **出貨選取**：永久清除被勾選的訂單（沿用出貨即刪除、無法復原語意），執行前需二次確認並提示先備份。
2. **匯出選取訂單**：將被勾選的訂單匯出為 xlsx（沿用現行「依縣市分頁」格式），只下載、不清除、可重複。

後端新增一支子路由 `app/api/orders/selection/route.ts`：`POST` 依 id 清單匯出、`DELETE` 依 id 清單出貨。資料層在 `app/lib/orders.ts` 新增 `getOrdersByIds` 與 `deleteOrdersByIds`；現行 `close` 路由的 xlsx 組裝邏輯抽成共用 helper 供兩處復用。勾選限定單一路線視圖，切換路線即清空（FR-011）。**不改 schema、不新增資料表欄位。**

## Technical Context

**Language/Version**: TypeScript 5（strict）／React 19／Next.js 16.2.4（App Router）

**Primary Dependencies**: antd v6（`Table` 的 `rowSelection` + `preserveSelectedRowKeys`）、NextAuth v5、`@neondatabase/serverless`（Neon HTTP tagged-template）、`xlsx`（既有匯出用）、既有 `app/lib/csv.ts`（`safeFilename`、`taipeiDateStamp`）、`app/lib/api-client.ts`

**Storage**: Neon Postgres。**本功能不改 schema**（沿用 `orders` / `order_items`）。無 migration。

**Testing**: 無測試框架；以 `npm run lint` + `npm run build`（型別檢查）+ 手動驗證（quickstart.md）為準。

**Target Platform**: Web（管理後台，桌機／行動瀏覽器），使用者介面 zh-TW。

**Project Type**: Next.js App Router 單一 web 專案（`app/` 前端頁面 + `app/api/` 路由 + `app/lib/` 資料層）。

**Performance Goals**: 一般後台互動；每檔數十～數百筆訂單，選取匯出／出貨為單一 HTTP 往返。

**Constraints**: Neon HTTP 無互動式交易 → 依 id 清單刪除以單一 `DELETE ... WHERE id = ANY(...)` 語句達成，天然為原子；SQL 一律走 tagged template 參數化（id 陣列以 `ANY(${ids})` 傳入）；被勾選訂單於執行時部分已消失時，`RETURNING`/查詢天然只作用於仍存在者（FR-010）。

**Scale/Scope**: 影響檔案約 4 個：`orders/page.tsx`（UI 勾選＋兩動作）、`app/api/orders/selection/route.ts`（新增）、`app/lib/orders.ts`（新增兩函式）、`app/lib/validation.ts`（新增 id 清單驗證）；另抽出 `app/lib/order-export.ts` 共用 xlsx 組裝並回頭讓 `close/route.ts` 復用。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | 原則 | 判定 | 說明 |
|---|------|------|------|
| I | Read Bundled Docs Before Framework Code | ✅ Pass | 僅動 client page 與既有模式的 route handler（`jsonHandler`、`"use client"`）；antd `rowSelection` 為既有 UI 庫用法，無新框架行為。 |
| II | Parameterized SQL Only（NON-NEGOTIABLE） | ✅ Pass | 新增 `getOrdersByIds`／`deleteOrdersByIds` 皆寫在 `app/lib/orders.ts`，以 `sql` tagged template 參數化，id 清單以 `= ANY(${ids})` 傳入，無字串拼接。 |
| III | Deny-by-Default Authorization | ✅ Pass | 新 `POST`/`DELETE /api/orders/selection` 受 `proxy.ts` 全域守衛；並比照 `close/route.ts` 於這些變更/敏感端點顯式呼叫 `auth()` 作縱深防禦。 |
| IV | No Orphaned Images | ✅ N/A | 訂單／明細不含 Cloudinary 影像。 |
| V | Orders Are Mutable Until Shipment, Immutable in History | ✅ Pass | 出貨選取＝現行「出貨即清除」語意的作用範圍細化（整組 → 任意勾選），仍以出貨為清帳邊界，未保留可竄改的歷史；不改快照/原子性規則。與 1.2.0 版原則 V 相符，**不需修憲**。 |

**Gate 結果**：全部通過，無偏離，Complexity Tracking 留空。

## Project Structure

### Documentation (this feature)

```text
specs/006-order-selection-actions/
├── plan.md              # 本檔
├── research.md          # Phase 0：決策與理由
├── data-model.md        # Phase 1：實體、驗證、狀態
├── quickstart.md        # Phase 1：手動驗證流程
├── contracts/           # Phase 1：API 合約
│   ├── export-selected.md
│   └── ship-selected.md
├── checklists/
│   └── requirements.md  # /speckit-specify 產出
└── tasks.md             # /speckit-tasks 產出（本命令不建立）
```

### Source Code (repository root)

```text
app/
├── (admin)/orders/page.tsx          # 修改：Table rowSelection（跨頁保留、切路線清空）、
│                                     #       已選數量列＋「出貨選取」「匯出選取訂單」按鈕與確認
├── api/orders/
│   ├── route.ts                     # 不變（路線清單／建立訂單）
│   ├── close/route.ts               # 調整：xlsx 組裝改呼叫抽出的 order-export helper（行為不變）
│   └── selection/route.ts           # 新增：POST（依 ids 匯出 xlsx）、DELETE（依 ids 出貨清除）
└── lib/
    ├── orders.ts                    # 新增：getOrdersByIds、deleteOrdersByIds
    ├── order-export.ts              # 新增：由 OrderRow[] 組裝依縣市分頁的 xlsx buffer（close 與 selection 共用）
    └── validation.ts                # 新增：validateOrderIdsBody
```

**Structure Decision**: 沿用既有 Next.js App Router 單一專案結構。選取層級的動作獨立成 `app/api/orders/selection/route.ts`，與分組層級的 `close/route.ts` 並存（FR-012），避免把「id 清單」語意硬塞進既有 `{method, routeId}` 端點。所有 SQL 集中於 `app/lib/orders.ts`，xlsx 組裝集中於 `app/lib/order-export.ts`。

## Complexity Tracking

> 無 Constitution 偏離，故不填。
