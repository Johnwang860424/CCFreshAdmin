# Implementation Plan: 商品庫存管理與防止超賣

**Branch**: `main`（實作時建議開 `feature/product-inventory`） | **Date**: 2026-07-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-product-inventory/spec.md`

## Summary

`products` 加 **nullable `stock INTEGER`** 欄（NULL＝不限量、既有商品免回填；具名 CHECK `stock >= 0`）。防超賣核心＝**把庫存扣減放進訂單寫入的同一條單一 CTE 語句**：任一品項扣到負值即觸發 CHECK 23514、整句原子失敗——併發下 UPDATE 行鎖序列化，DB 為最終防線；扣減前先預檢庫存以回「「商品名」庫存不足（剩餘 N）」的友善 400，23514 為競態後援（重查庫存組同款訊息）。編輯訂單以**每商品淨差額**（新−舊合計）做同句扣/補；單筆刪除訂單回補；出貨（結單/選取出貨）不回補。商品管理頁表單加庫存欄（留空＝不限量）、列表加剩餘庫存欄（售完/不限量標示）；後台訂單商品選單將 stock=0 的商品標示售完並 disabled。訂單寫入後 revalidate `products` 快取讓列表/選單即時。顧客端 App 寫入路徑零改動（欄位 additive、App 不扣庫存）。

## Technical Context

**Language/Version**: TypeScript（strict）/ Next.js 16.2.4 / React 19

**Primary Dependencies**: antd v6（商品管理、訂單頁 UI）、`@neondatabase/serverless`（Neon HTTP，無互動式交易 → 單語句原子性）

**Storage**: Neon Postgres — migration `db/migrations/007_add_product_stock.sql`：`ALTER TABLE products ADD COLUMN stock INTEGER` + `CONSTRAINT products_stock_nonneg CHECK (stock IS NULL OR stock >= 0)`；`db/schema.sql` 同步（憲法 Development Workflow）

**Testing**: 無測試框架（憲法）；`npm run lint`、`npm run build` + quickstart.md 手動驗證（含併發下單驗證）

**Target Platform**: Vercel／Node server（既有部署），管理後台瀏覽器

**Performance Goals**: 無新增查詢負載——`getProducts` 多帶一欄；訂單寫入多一個 UPDATE 子句與一次預檢 SELECT

**Constraints**: UI zh-TW；顧客端 App 寫入路徑不可變（FR-010，欄位 additive、App 不觸 stock）；`getProducts` 有 `unstable_cache`（tag `products`）→ 訂單異動後必須 revalidate 否則列表/選單顯示過期庫存

**Scale/Scope**: 商品數十個；異動 ≈ 1 migration + 3 個 lib 檔 + 4 個 API route 檔 + 2 個頁面

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | 評估 | 結果 |
|---|-----------|------|------|
| I | Read the Bundled Docs | 不觸及 routing/proxy/server-client 邊界；`unstable_cache`/revalidate 沿用既有 `app/lib/revalidate.ts` 模式 | PASS |
| II | Parameterized SQL Only | 扣減/回補/預檢全走 `sql` tagged template，集中於 `app/lib/orders.ts`、`app/lib/products.ts`；數量與 id 一律參數化（unnest 平行陣列，沿用既有寫法） | PASS |
| III | Deny-by-Default Authorization | 無新端點；順手為本次觸及的變更端點（products POST/PUT、orders POST）補顯式 `auth()` 檢查（orders/[id] 已有），對齊憲法縱深防禦 | PASS |
| IV | No Orphaned Images | 不涉及圖片 | PASS |
| V | Orders Mutable Until Shipment | 強化而非違反：庫存扣減與訂單寫入同一單語句原子；快照欄位規則不變（stock 不快照、即時檢查）；出貨為結算邊界（不回補） | PASS |
| — | Technology Constraints | zh-TW 文案；兩頁面已是 `"use client"`；stock 驗證比照 price（非負整數，另允許 null）；schema 變更同步 `db/schema.sql` 並於 PR 說明遷移步驟 | PASS |

**Post-Phase-1 re-check**: 全數 PASS（欄位 additive、驗證雙層〔DB CHECK + API/表單〕、無新端點、原子性以單語句 CTE 達成）。

## Project Structure

### Documentation (this feature)

```text
specs/010-product-inventory/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── product-stock.md # 欄位/驗證/扣補規則/錯誤訊息契約
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
db/
├── schema.sql                       # 修改：products 補 stock 欄（nullable + 具名 CHECK）
└── migrations/
    └── 007_add_product_stock.sql    # 新增：ADD COLUMN stock + products_stock_nonneg CHECK

app/
├── lib/
│   ├── products.ts        # 修改：ProductRow.stock；getProducts 帶 stock；
│   │                      #        addProduct / updateProductDetails 增 stock 參數
│   ├── orders.ts          # 修改：createOrder 預檢＋同句扣減；updateOrderItems 淨差額扣/補
│   │                      #        （既有明細快照查詢補 quantity）；deleteOrder 同句回補；
│   │                      #        StockInsufficientError（或沿用 OrderInputError）＋23514 分流；
│   │                      #        deleteOrdersByIds / deleteOrdersByGroup（出貨）不動＝不回補
│   └── validation.ts      # 修改：validateProductBody 增 stock（null 或非負整數）
├── api/
│   ├── products/
│   │   ├── route.ts       # 修改：POST 帶 stock；補顯式 auth()
│   │   └── [id]/route.ts  # 修改：PUT 帶 stock；補顯式 auth()
│   └── orders/
│       ├── route.ts       # 修改：POST 補顯式 auth()；成功後 revalidate "products"；
│       │                  #        庫存不足 → 400 明確訊息
│       └── [id]/route.ts  # 修改：PUT/DELETE 成功後 revalidate "products"；庫存不足 → 400
└── (admin)/
    ├── products/page.tsx  # 修改：表單庫存欄（InputNumber，留空＝不限量）；
    │                      #        列表庫存欄（數字／不限量／售完 Tag）
    └── orders/page.tsx    # 修改：新增/編輯訂單商品選單——stock=0 顯示「售完」且 disabled，
                           #        選項附「剩餘 N」提示（FR-011）
```

**Structure Decision**: 沿用既有單一專案結構與「一實體一資料模組」慣例。stock 的讀寫集中在 `products.ts`（欄位維護）與 `orders.ts`（隨訂單原子扣/補）；不新增端點、不新增模組。防超賣的正確性錨在 DB 的具名 CHECK——所有寫入路徑（含未來擴充）共用同一最終防線。

## Complexity Tracking

無憲法違規，無需填寫。

## Design Notes（關鍵決策摘要，詳見 research.md）

- **D1 欄位**：`stock INTEGER`（nullable，NULL＝不限量）＋具名 `CONSTRAINT products_stock_nonneg CHECK (stock IS NULL OR stock >= 0)`；migration `007`，既有商品不回填（預設不限量，符合 clarification）。
- **D2 原子防超賣**：`createOrder` 的單一 CTE 語句內加 `dec` CTE——以「每商品合計數量」`UPDATE products SET stock = stock - qty WHERE id = … AND stock IS NOT NULL`；不足時 CHECK 23514 使整句失敗（訂單、明細、扣減零部分效果）。UPDATE 行鎖使併發序列化，第二筆看到已扣後的值 → SC-001 的零超賣由 DB 保證。
- **D3 友善錯誤**：寫入前預檢（SELECT id,name,stock）組「「商品名」庫存不足（剩餘 N）」400；競態漏網由 23514 catch（依 constraint 名 `products_stock_nonneg` 分流）→ 重查庫存組同款訊息。與既有 `OrderInputError` 同通道（訂單頁已顯示 400 error 訊息）。
- **D4 同商品多列**：扣減前以 product_id 合計（避免 UPDATE…FROM 重複列只套一次的陷阱）；檢查亦以合計對剩餘量（spec edge case）。
- **D5 編輯訂單＝淨差額**：TS 端算 每商品 delta = 新合計 −舊合計（舊值來自既有明細快照查詢，需補選 `quantity`；product_id 為 NULL 的已刪商品列自然略過），單一 UPDATE 套 delta（正＝扣、負＝補），與 del/ins/total 同句原子；僅正 delta 需預檢。
- **D6 刪單回補、出貨不回補**：`deleteOrder`（單筆刪除）改單句 CTE——DELETE orders ＋讀同語句快照的 order_items 合計回補 stock（CTE 各部分讀同一 snapshot，CASCADE 不影響讀值）。`deleteOrdersByIds`（選取出貨）與 `deleteOrdersByGroup`（結單出貨）零改動＝不回補（clarification 裁決）。
- **D7 快取一致**：`getProducts` 被 `unstable_cache` 包住 → orders POST/PUT/DELETE 於庫存異動成功後 `revalidateCache("products")`，商品列表與訂單商品選單即時反映剩餘量。
- **D8 App 相容**：欄位 additive；App 寫訂單不觸 stock（不扣減）——後台對 App 訂單的編輯/刪除仍套統一扣/補規則（spec FR-007 不分來源；管理員以「剩餘可售」心智模型自行維護計數）。
- **D9 UI**：商品表單 `InputNumber`（min 0、precision 0、可留空）；列表欄位：數字／「不限量」灰字／「售完」紅 Tag（stock=0）。訂單商品選單：stock=0 → `disabled` ＋「售完」標示，其餘顯示「剩餘 N」；數量欄不做前端上限（送出時後端最終防線擋）。
