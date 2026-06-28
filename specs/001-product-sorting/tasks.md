---

description: "Task list for 商品排序功能 (Product Sorting)"
---

# Tasks: 商品排序功能 (Product Sorting)

**Input**: Design documents from `specs/001-product-sorting/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/products-reorder.md

**Tests**: 專案無測試框架，spec 未要求 TDD → 不產生自動化測試任務；以 `quickstart.md` 手動驗證。

**Organization**: 任務依 user story 分組，可獨立實作與驗證。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、無未完成相依）
- **[Story]**: 對應 spec 的 US1/US2/US3
- 描述含確切檔案路徑

## Path Conventions

Next.js App Router 單一專案，路徑相對 repo root（`app/`, `db/`）。

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 安裝拖拉相依

- [X] T001 安裝拖拉相依套件：`npm i @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`（更新 `package.json` / `package-lock.json`）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: `sort_order` 欄位與資料層基礎，所有 user story 皆依賴

**⚠️ CRITICAL**: 本階段完成前，任何 user story 無法開始

- [X] T002 新增既有環境一次性 migration `db/migrations/001_add_product_sort_order.sql`：`ALTER TABLE products ADD COLUMN sort_order INTEGER;` → `UPDATE products SET sort_order = id;` → `ALTER TABLE products ALTER COLUMN sort_order SET NOT NULL;` → `CREATE INDEX idx_products_sort_order ON products(sort_order);`（見 data-model.md）
- [X] T003 [P] 更新 `db/schema.sql`：在 `products` 定義加入 `sort_order INTEGER NOT NULL,` 並於檔末加 `CREATE INDEX idx_products_sort_order ON products(sort_order);`（新環境用）
- [X] T004 在 `app/lib/products.ts`：`ProductDbRow` 加 `sort_order: number`、`ProductRow` 加 `sortOrder: number`、`toProductRow` 對應；`getProducts` 的 SELECT 加 `p.sort_order`，並改 `ORDER BY p.sort_order, p.id`

**Checkpoint**: 商品讀取已依 `sort_order` 排序，欄位就緒——可開始 user story

---

## Phase 3: User Story 1 - 拖拉排序商品 (Priority: P1) 🎯 MVP

**Goal**: 管理員以拖拉調整商品順序，放開即原子儲存並持久化；失敗時回滾

**Independent Test**: 在 `/products` 拖動某商品到新位置，重新整理後順序維持（quickstart Scenario 2）

### Implementation for User Story 1

- [X] T005 [US1] 在 `app/lib/products.ts` 新增 `reorderProducts(ids: number[]): Promise<void>`，以單一 SQL（`UPDATE products AS p SET sort_order = v.ord FROM (SELECT id, ord FROM unnest(${ids}::int[]) WITH ORDINALITY AS t(id, ord)) v WHERE p.id = v.id`）原子重寫順序
- [X] T006 [P] [US1] 在 `app/lib/validation.ts` 新增 `validateReorderBody(body)`：驗證 `ids` 為非空、皆正整數、不重複的陣列，回傳既有 `{ value } | { error }` 形狀
- [X] T007 [US1] 新增 `app/api/products/reorder/route.ts`：`PUT` 用 `jsonHandler` + `validateReorderBody`，呼叫 `reorderProducts`，成功後 `revalidateCache("products")`，回傳 `{ success: true }`（依 contracts/products-reorder.md）
- [X] T008 [US1] 在 `app/(admin)/products/page.tsx` 將 `Table` 改為可拖拉：以 `DndContext` + `SortableContext`（dnd-kit）包住，新增可排序的 `row` component 與拖拉把手欄；`onDragEnd` 先樂觀更新本地 `data`、呼叫 `putJson("/api/products/reorder", { ids })`，失敗則還原順序並 `messageApi.error`（FR-007/FR-008）
- [X] T009 [US1] 在 `app/(admin)/products/page.tsx` 加入「排序模式」切換：進入時顯示完整清單、停用搜尋過濾與分頁，離開時恢復（research.md Decision 5）

**Checkpoint**: US1 可獨立運作——拖拉、持久化、失敗回滾皆可驗證

---

## Phase 4: User Story 2 - 新商品排在尾端 (Priority: P2)

**Goal**: 新增商品自動排在現有順序最後

**Independent Test**: 新增一筆商品，確認其出現在列表最末（quickstart Scenario 3）

### Implementation for User Story 2

- [X] T010 [US2] 在 `app/lib/products.ts` 的 `addProduct` INSERT 加入 `sort_order` 欄位，值為 `(SELECT COALESCE(MAX(sort_order),0)+1 FROM products)`（FR-003）

**Checkpoint**: 新增商品穩定排尾，且可被 US1 拖拉

---

## Phase 5: User Story 3 - 既有商品的初始順序 (Priority: P3)

**Goal**: 上線後所有既有商品具確定、唯一的初始順序，無遺漏無重複

**Independent Test**: 於含既有商品的資料套用 migration 後，確認每筆商品順序與套用前一致且完整（quickstart Scenario 1）

### Implementation for User Story 3

- [ ] T011 [US3] 對既有 Neon 資料庫執行 `db/migrations/001_add_product_sort_order.sql`（Neon SQL Editor），驗證 `sort_order` 全部回填、唯一、與 `id` 序一致（FR-004 / SC-002）

**Checkpoint**: 所有 user story 皆可獨立驗證

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 收尾與整體驗證

- [X] T012 [P] 執行 `npm run lint` 並修正本功能新增/變更檔案的問題
- [ ] T013 依 `specs/001-product-sorting/quickstart.md` 跑完 Scenario 1–5（含邊界：空清單、單筆、跨分頁、失敗回滾）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 無相依，可立即開始
- **Foundational (Phase 2)**: 需 Setup 完成；BLOCKS 所有 user story
- **User Stories (Phase 3–5)**: 皆依賴 Foundational
  - US1 為 MVP；US2、US3 可於 Foundational 後平行進行
- **Polish (Phase 6)**: 需所有目標 story 完成

### User Story Dependencies

- **US1 (P1)**: Foundational 後即可開始，無跨 story 相依
- **US2 (P2)**: Foundational 後即可開始；與 US1 共用 `products.ts` 但任務不同段落
- **US3 (P3)**: 即 migration 之執行/驗證；與 T002（撰寫 migration）相依

### Within Each User Story

- US1：T005（資料層）→ T007（route，依 T005/T006）；T008 → T009（同檔 `page.tsx`，依序）
- 資料層 before route before UI

### Parallel Opportunities

- T003 與 T002 可平行（不同檔案）
- T006 與 T005 可平行（不同檔案）
- Foundational 完成後，US1 / US2 可由不同人平行
- T012 可與 T013 前的收尾平行

---

## Parallel Example: User Story 1

```bash
# 資料層與驗證可平行：
Task: "reorderProducts in app/lib/products.ts"          # T005
Task: "validateReorderBody in app/lib/validation.ts"    # T006
# 完成後再做 route（T007），最後 UI（T008 → T009）
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup（裝 dnd-kit）
2. Phase 2 Foundational（migration + 資料層排序）— 阻擋所有 story
3. Phase 3 US1（reorder API + 拖拉 UI）
4. **STOP & VALIDATE**：依 quickstart Scenario 2 驗證 US1
5. 可上線/示範

### Incremental Delivery

1. Setup + Foundational → 基礎就緒
2. US1 → 驗證 → 上線（MVP！）
3. US2 → 驗證 → 上線
4. US3 → 在正式環境執行 migration 並驗證

---

## Notes

- [P] = 不同檔案、無相依
- 注意 `app/lib/products.ts` 被 T004/T005/T010 共改、`page.tsx` 被 T008/T009 共改 → 同檔任務勿同時動手
- Neon serverless HTTP 無互動式交易，排序儲存以「單一 SQL」達原子（T005）
- 所有插補走 `sql` 標籤模板自動參數化，勿字串拼接
- 每完成一任務或邏輯群組即 commit
