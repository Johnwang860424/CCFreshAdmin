# Implementation Plan: 後台新增訂單與來源標籤

**Branch**: `002-admin-order-creation` | **Date**: 2026-06-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-admin-order-creation/spec.md`

## Summary

在訂單管理頁（`app/(admin)/orders/page.tsx`）新增「新增訂單」按鈕與表單 Modal，讓管理員手動建立訂單（自取／宅配、多項商品、備註）。`orders` 新增 `tag TEXT NOT NULL DEFAULT '網站'` 欄位記錄來源（網站／FB／Line）。後端新增 `POST /api/orders`（顯式 `auth()` 守門），透過 `app/lib/orders.ts` 的 `createOrder()` 以**單一 CTE SQL 語句**原子寫入訂單主檔與明細，並在自取時依既有約定指派 `pickup_number`（撞唯一鍵時重試）。明細小計與總額以伺服器端「商品目前單價＋促銷」快照計算（`calcLineSubtotal`），確保歷史不可變。`tag` 一併納入訂單清單顯示與結單 CSV 匯出。

## Technical Context

**Language/Version**: TypeScript (strict), React 19, Next.js 16.2.4 (App Router)

**Primary Dependencies**: antd v6（`@ant-design/nextjs-registry`）、NextAuth v5（Auth.js beta）、`@neondatabase/serverless`（Neon Postgres，HTTP driver）

**Storage**: Neon Postgres，原始 SQL 透過 `app/lib/db.ts` 的 `sql` tagged template

**Testing**: 無測試框架；以 `npm run lint` 與 `npm run build`（型別檢查）＋手動驗證（quickstart.md）

**Target Platform**: Web（伺服器端 SSR ＋ 客戶端 antd）

**Project Type**: Web application（Next.js 單一專案，App Router）

**Performance Goals**: 一般後台互動延遲；新增訂單為單筆寫入，無高併發需求

**Constraints**: Neon serverless HTTP driver **無互動式交易**，多列寫入須以單一 SQL 語句達成原子性；antd v6 compound statics 需 `"use client"`；UI 為 zh-TW

**Scale/Scope**: 單一後台管理員等級用量；本功能新增 1 個 DB 欄位、1 條 API（POST）、1 個資料模組函式、1 個前端 Modal 表單，並調整既有清單欄位與 CSV 匯出

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 評估 | 結論 |
|------|------|------|
| I. 先讀 bundled docs | 新增 route handler 與資料寫入沿用既有模式（`jsonHandler`、`sql` tagged template、`auth()`）；如涉及 App Router 寫法以 `node_modules/next/dist/docs/` 為準 | PASS |
| II. 僅參數化 SQL（NON-NEGOTIABLE） | 所有寫入經 `sql` tagged template；`createOrder` 以 CTE＋`unnest` 參數化陣列，無字串拼接 | PASS |
| III. Deny-by-default 授權 | 新 `POST /api/orders` **會變更資料**，而 `proxy.ts` matcher 不涵蓋 `api`；故此 handler MUST 顯式呼叫 `auth()` 驗證後才寫入 | PASS（須落實，見 research） |
| IV. 不留孤兒圖片 | 本功能不涉及 Cloudinary 圖片 | N/A |
| V. 訂單歷史不可變 | 本功能為**新增（append-only）**，不修改既有訂單；明細仍快照 `product_name/unit_price/promo_*/subtotal`。屬對原則 V 範圍的合理擴充（由唯讀＋匯出＋清除，擴及「新增」），既有訂單之不可變性不受影響 | PASS（擴充，見 Complexity Tracking） |

**Technology Constraints / Workflow**:
- Schema 變更 MUST 更新 `db/schema.sql` 並於 PR 說明 migration（新增 `orders.tag` 欄位、對既有列回填預設值）。
- 涉及 antd compound statics 的檔案維持 `"use client"`（orders/page.tsx 已是）。
- 完成前 `npm run lint` 與 `npm run build` MUST 通過。

## Project Structure

### Documentation (this feature)

```text
specs/002-admin-order-creation/
├── plan.md              # 本檔
├── research.md          # Phase 0 決策
├── data-model.md        # Phase 1 資料模型
├── quickstart.md        # Phase 1 驗證指南
├── contracts/
│   └── orders-api.md    # POST /api/orders 合約
└── checklists/
    └── requirements.md  # 規格品質檢查（/speckit-specify 產出）
```

### Source Code (repository root)

```text
db/
└── schema.sql                       # 變更：orders 新增 tag 欄位

app/
├── (admin)/orders/page.tsx          # 變更：新增「新增訂單」按鈕＋表單 Modal、清單顯示 tag
├── api/orders/
│   ├── route.ts                     # 變更：新增 POST（auth() 守門、驗證、呼叫 createOrder）
│   └── close/route.ts               # 變更：CSV 匯出 header/列加入「來源」欄
└── lib/
    ├── orders.ts                    # 變更：OrderRow 加 tag；新增 createOrder()；查詢 SELECT 帶 o.tag
    └── validation.ts                # 變更：新增 validateCreateOrderBody()
```

**Structure Decision**: 沿用既有 Next.js App Router 單一專案結構與「一實體一資料模組」慣例。不新增目錄；新增訂單的寫入邏輯集中於 `app/lib/orders.ts`，驗證集中於 `app/lib/validation.ts`，REST 端點掛在既有 `app/api/orders/route.ts` 的 `POST`。

## Complexity Tracking

> 僅在 Constitution Check 有需說明的偏離時填寫。

| 偏離 | 為何需要 | 為何不採更簡方案 |
|------|----------|------------------|
| 擴充原則 V：admin 可「新增」訂單（原為唯讀＋匯出＋清除） | 需求即為「後台也能新增訂單」，涵蓋電話／私訊管道收單 | 維持純唯讀無法滿足需求；以 append-only＋明細快照方式實作，不修改既有訂單，最大程度保留原則 V 的不可變精神。建議後續以 `/speckit-constitution` 將原則 V 措辭更新為「既有訂單不可變、可 append 新訂單」 |
