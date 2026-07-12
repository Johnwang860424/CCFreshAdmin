# Tasks: 商品庫存管理與防止超賣

**Input**: Design documents from `/specs/010-product-inventory/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/product-stock.md, quickstart.md

**Tests**: 無測試框架（憲法）——不產生測試任務；驗證＝`npm run lint`、`npm run build` ＋ quickstart.md 手動驗證。

**Organization**: 依 user story 分組，各 story 可獨立完成與驗證。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、無未完成依賴）
- **[Story]**: 所屬 user story（US1/US2/US3）

---

## Phase 1: Setup（Schema）

**Purpose**: 建立 `stock` 欄位——所有 story 的共同前提

- [X] T001 新增 migration `db/migrations/007_add_product_stock.sql`：`ALTER TABLE products ADD COLUMN stock INTEGER, ADD CONSTRAINT products_stock_nonneg CHECK (stock IS NULL OR stock >= 0);`（nullable、既有商品不回填＝不限量），並於 Neon SQL Editor 手動執行
- [X] T002 [P] 同步 `db/schema.sql`：products 表加入 `stock INTEGER` 欄與具名 `products_stock_nonneg` CHECK（憲法 Development Workflow）

---

## Phase 2: Foundational（讀取路徑）

**Purpose**: `ProductRow.stock` 讀得到——US1 列表/表單、US2 選單、US3 訊息全靠它

**⚠️ CRITICAL**: 本階段完成前不得開始任何 user story

- [X] T003 `app/lib/products.ts`：`ProductDbRow`/`ProductRow` 增 `stock: number | null`，`getProducts()` SELECT 增 `p.stock`，`toProductRow` 帶出（NULL 原樣傳遞，不轉 0）

**Checkpoint**: `GET /api/products` 回傳含 `stock` —— user story 可開工

---

## Phase 3: User Story 1 - 後台維護商品庫存 (Priority: P1) 🎯 MVP

**Goal**: 商品管理頁可設定/調整庫存（留空＝不限量），列表顯示剩餘量與售完/不限量標示

**Independent Test**: quickstart.md「US1」節——新增商品庫存 10 → 列表顯示 10；改 5 → 同步；`-3`/`2.5` 被擋；清空 → 不限量；0 → 紅色售完

- [X] T004 [P] [US1] `app/lib/validation.ts`：`validateProductBody` 增 `stock` 解析——缺省/`null` → `null`；否則須 `Number.isInteger && >= 0`，不合法回 400「庫存必須為 0 或正整數」（比照 price 的驗證寫法，回傳 value 增 `stock: number | null`）
- [X] T005 [P] [US1] `app/lib/products.ts`：`addProduct` 與 `updateProductDetails` 增 `stock: number | null` 參數並寫入 INSERT/UPDATE（沿用參數化 tagged template）
- [X] T006 [US1] `app/api/products/route.ts`：POST 取 `parsed.value.stock` 傳給 `addProduct`；補顯式 `auth()` 檢查（比照 `app/api/orders/[id]/route.ts` 的 `requireAuth`，憲法原則 III）（depends on T004, T005）
- [X] T007 [P] [US1] `app/api/products/[id]/route.ts`：PUT 取 `stock` 傳給 `updateProductDetails`；補顯式 `auth()` 檢查（depends on T004, T005）
- [X] T008 [US1] `app/(admin)/products/page.tsx`：新增/編輯表單加「庫存」`InputNumber`（min 0、precision 0、可留空、placeholder「留空＝不限量」）；submit payload 帶 `stock`（空 → null）；編輯開窗預填現值
- [X] T009 [US1] `app/(admin)/products/page.tsx`：列表新增「庫存」欄——`null` → 灰字「不限量」、`0` → 紅色「售完」Tag、`>0` → 數字（同檔，接續 T008）

**Checkpoint**: US1 可獨立驗證（quickstart US1 全數通過）——MVP 可交付

---

## Phase 4: User Story 2 - 新增訂單時防止超賣 (Priority: P2)

**Goal**: 後台新增訂單原子檢查＋扣減庫存；不足整筆拒絕並提示「「商品名」庫存不足（剩餘 N）」；併發零超賣；售完商品選單不可選

**Independent Test**: quickstart.md「US2」節——庫存 3 訂 2 成功剩 1；再訂 2 被拒（訊息含剩餘 1）；混合訂單整筆拒且零扣減；curl 併發恰一筆成立；售完商品選單 disabled

- [X] T010 [US2] `app/lib/orders.ts`：`createOrder` 防超賣——(a) `ProductSnapshot` 增 `stock`，既有商品查詢多帶 `stock`；(b) 寫入前以每商品合計數量預檢，任一不足擲 `OrderInputError`，訊息「「商品名」庫存不足（剩餘 N）」（多筆併列）；(c) `insertOnce` 的 CTE 增 `dec`——`UPDATE products SET stock = stock - qty FROM (unnest 每商品合計) WHERE id = … AND stock IS NOT NULL`（與訂單/明細同句原子，D2/D4）；(d) catch SQLSTATE 23514 且 constraint 名 `products_stock_nonneg` → 重查庫存組同款訊息擲 `OrderInputError`（23505 重試邏輯不變、23514 不重試）
- [X] T011 [US2] `app/api/orders/route.ts`：POST 補顯式 `auth()` 檢查；`createOrder` 成功後 `revalidateCache("products")`（`@/app/lib/revalidate`，D7）（depends on T010）
- [X] T012 [P] [US2] `app/(admin)/orders/page.tsx`：新增/編輯訂單的商品 `Select` options——`stock === 0` → `disabled: true` ＋「售完」標示；`stock > 0` → 標籤附「剩餘 N」；`stock === null` → 現行外觀（FR-011；兩個 modal 共用同一 options 建構處）

**Checkpoint**: US1＋US2 皆可獨立驗證；SC-001 併發驗證通過

---

## Phase 5: User Story 3 - 編輯／刪除訂單同步調整庫存 (Priority: P3)

**Goal**: 改單淨增套檢查扣減、淨減/移除回補；單筆刪單回補；出貨（結單/選取出貨）不回補

**Independent Test**: quickstart.md「US3」節——3→4 僅扣 1；剩 1 改 +2 整次被拒；4→1 回補 3；刪單回補；出貨與選取出貨皆不回補

- [X] T013 [US3] `app/lib/orders.ts`：`updateOrderItems` 淨差額扣/補——(a) `ExistingItemSnapshot` 增 `quantity`，既有明細查詢多帶；(b) TS 計算每商品 `delta = 新合計 − 舊合計`（`product_id IS NULL` 列略過）；(c) 正 delta 預檢（查該組商品 name/stock，不足擲 `OrderInputError` 同款訊息）；(d) del/ins/total 的 CTE 增 stock UPDATE（`stock = stock - delta`，正扣負補，`WHERE stock IS NOT NULL`）；(e) 23514＋`products_stock_nonneg` 分流同 T010（depends on T010——共用訊息組裝/分流輔助）
- [X] T014 [US3] `app/lib/orders.ts`：`deleteOrder` 改單一 CTE——`DELETE FROM orders … RETURNING id` ＋ 由同語句 snapshot 的 `order_items` 每商品合計回補 `UPDATE products SET stock = stock + q WHERE … AND stock IS NOT NULL`（D6）；確認 `deleteOrdersByIds` 與 `deleteOrdersByGroup` 零改動（出貨不回補）（同檔，接續 T013）
- [X] T015 [US3] `app/api/orders/[id]/route.ts`：PUT 與 DELETE 成功後 `revalidateCache("products")`（`OrderInputError` → 400 的既有 mapping 已涵蓋庫存不足訊息）（depends on T013, T014）

**Checkpoint**: 三個 user story 全數可獨立驗證

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: 文件同步與整體驗證

- [X] T016 [P] 更新 `CLAUDE.md` Data layer 段落：記錄 `products.stock` 語意（nullable＝不限量、剩餘可售計數器、隨訂單原子扣/補、出貨不回補、App 不扣、`products_stock_nonneg` 23514 分流、訂單異動後 revalidate `products`）
- [X] T017 `npm run lint` 與 `npm run build` 全數通過（憲法 Development Workflow）
- [ ] T018 執行 `specs/010-product-inventory/quickstart.md` 全部驗證（US1–US3、併發、快取鮮度、App 相容），逐項記錄結果

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1（Setup）**: 無依賴，立即可做；T001 與 T002 可平行
- **Phase 2（Foundational）**: 依賴 T001（欄位存在才能 SELECT）——**阻擋所有 user story**
- **Phase 3–5（US1–US3）**: 皆依賴 Phase 2；US1 與 US2 互相獨立可平行；US3 依賴 US2 的 T010（共用庫存不足訊息與 23514 分流邏輯）
- **Phase 6（Polish）**: 依賴所有目標 story 完成

### User Story Dependencies

- **US1 (P1)**: 僅依賴 Phase 2——獨立
- **US2 (P2)**: 僅依賴 Phase 2——獨立（驗證時可用 SQL 直接設庫存，不需 US1 UI）
- **US3 (P3)**: 依賴 US2 的 T010（同檔同輔助函式）；驗證面獨立

### Within Each Story

- US1: T004/T005 平行 → T006/T007 → T008 → T009（T008/T009 同檔循序）
- US2: T010 → T011；T012 與 T010/T011 平行（不同檔）
- US3: T013 → T014（同檔）→ T015

### Parallel Opportunities

```text
Phase 1:  T001 ─┬─ T002 [P]
Phase 2:  T003
US1:      T004 [P] ─┬─ T005 [P] → T006、T007 [P] → T008 → T009
US2:      T010 → T011；T012 [P]（與 T010/T011 平行）
跨story:  Phase 2 完成後 US1（products.ts/頁面）與 US2 的 T012（orders 頁）可由不同人平行
US3:      T013 → T014 → T015
Polish:   T016 [P]（可提早寫）→ T017 → T018
```

---

## Implementation Strategy

### MVP First（US1 only）

1. Phase 1（migration + schema 同步）→ Phase 2（讀取路徑）
2. Phase 3（US1）→ quickstart US1 驗證 → 可交付（管理員先看得到/改得動庫存）

### Incremental Delivery

1. Setup + Foundational → 基礎就緒
2. US1 → 驗證 → 交付（庫存可維護，MVP）
3. US2 → 驗證（含併發 SC-001）→ 交付（新增訂單防超賣＝核心價值）
4. US3 → 驗證 → 交付（改單/刪單一致性閉環）
5. Polish → lint/build/quickstart 全綠 → PR（說明 migration 步驟，憲法）

---

## Notes

- 全程遵守：SQL 只寫在 data module、一律 tagged template 參數化（憲法原則 II）；訂單相關寫入單語句原子（原則 V）
- `app/lib/orders.ts` 為 T010/T013/T014 共同檔案——US2/US3 的 lib 任務不可平行，依 T010 → T013 → T014 循序
- 出貨路徑（`orders/close`、`orders/selection`）**刻意零改動**——review 時確認未被波及
- 每完成一個 task 或邏輯群組即 commit；任一 checkpoint 可停下獨立驗證該 story
