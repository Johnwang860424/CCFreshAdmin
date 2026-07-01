---
description: "Task list for 訂單勾選出貨與匯出 CSV（跨頁選取）"
---

# Tasks: 訂單勾選出貨與匯出 CSV（跨頁選取）

**Input**: Design documents from `specs/006-order-selection-actions/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: 本專案無測試框架（CLAUDE.md）；不產生自動化測試任務，改以 `npm run lint` + `npm run build`（型別檢查）+ `quickstart.md` 手動驗收把關。

**Organization**: 依 spec.md 的三個 user story（US1 出貨選取 P1、US2 匯出選取訂單 P1、US3 跨頁維持勾選 P2）分階段，各自可獨立驗收。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、無未完成相依）
- **[Story]**: 對應 user story（US1/US2/US3）；Setup / Foundational / Polish 無 Story 標籤

## Path Conventions

Next.js App Router 單一專案：頁面於 `app/(admin)/`、API 於 `app/api/`、資料層與工具於 `app/lib/`（見 plan.md「Source Code」）。

---

## Phase 1: Setup

**Purpose**: 變更前建立基準線

- [X] T001 於 repo root 執行 `npm run lint` 與 `npm run build` 確認變更前為綠燈基準（無需安裝新套件：antd / xlsx / NextAuth 皆已存在）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: US1/US2/US3 共用的資料層、驗證與列勾選骨架

**⚠️ CRITICAL**: 本階段完成前，任一 user story 皆無法實作

- [X] T002 [P] 於 `app/lib/validation.ts` 新增 `validateOrderIdsBody(body)`：驗證 `ids` 為非空、皆正整數、去重的陣列（比照既有 `validateReorderBody`），失敗回 400「選取資料格式錯誤」；供兩個 selection 端點共用
- [X] T003 [P] 於 `app/lib/orders.ts` 新增 `getOrdersByIds(ids: number[]): Promise<OrderRow[]>`（`WHERE o.id = ANY(${ids})`，`SELECT` 帶 `pickup_spot_city` / `pickup_spot_township`，明細以 `order_id = ANY(...)` 取回後 `assembleOrders`）與 `deleteOrdersByIds(ids: number[]): Promise<number>`（`DELETE FROM orders WHERE id = ANY(${ids}) RETURNING id`，回傳實際刪除筆數；`order_items` 由 CASCADE 清除）— 見 data-model.md
- [X] T004 於 `app/(admin)/orders/page.tsx` 為訂單 `Table` 加入列勾選骨架：`selectedRowKeys` state + 受控 `rowSelection`（每列勾選框、表頭全選）、顯示「已選 N 筆」指標、於路線下拉 `selected` 變動時將 `selectedRowKeys` 重設為 `[]`（FR-011）。此階段先為單頁勾選（跨頁保留留待 US3）

**Checkpoint**: 資料層 + 驗證 + 勾選骨架就緒，可開始各 user story

---

## Phase 3: User Story 1 - 勾選任意訂單並出貨 (Priority: P1) 🎯 MVP

**Goal**: 對目前路線視圖中被勾選的訂單一次出貨（永久清除），執行前二次確認並提示備份

**Independent Test**: 選一條路線，勾其中 2 筆，按「出貨選取」→ 確認後僅該 2 筆消失、其餘保留、勾選清空（quickstart 情境 1）

### Implementation for User Story 1

- [X] T005 [US1] 建立 `app/api/orders/selection/route.ts` 的 `DELETE` handler（`jsonHandler` 包裝）：顯式 `auth()`（未登入回 401）、以 `validateOrderIdsBody` 驗證 body、呼叫 `deleteOrdersByIds(ids)`、回 `{ deleted }`；錯誤訊息「清除訂單失敗」— 見 contracts/ship-selected.md
- [X] T006 [US1] 於 `app/(admin)/orders/page.tsx` 新增「出貨選取」按鈕（`selectedRowKeys.length === 0` 時 disabled，FR-007）：點擊以 `modal.confirm` 顯示將清除筆數 + 無法復原/建議先匯出警語（FR-006），確認後 `deleteJson("/api/orders/selection", { ids })`，成功則清空勾選並 `fetchRouteOptions()` + `fetchOrders(selected)`（FR-009），以回傳 `deleted` 提示實際筆數

**Checkpoint**: US1 可獨立運作——單頁勾選即可出貨任意子集

---

## Phase 4: User Story 2 - 勾選任意訂單並匯出 CSV (Priority: P1)

**Goal**: 將被勾選的訂單匯出為 xlsx（依縣市分頁），只下載、不清除、可重複

**Independent Test**: 勾分屬不同縣市的 3 筆，按「匯出選取訂單」→ 下載檔僅含該 3 筆、各縣市各成分頁、資料未清除、可再次匯出（quickstart 情境 2）

### Implementation for User Story 2

- [X] T007 [US2] 將 `app/api/orders/close/route.ts` 內的 xlsx 組裝（`EXPORT_HEADER`、`orderToRow`、`toSheetName`、依縣市分工作表、`zh-Hant` 排序）抽成 `app/lib/order-export.ts` 的 `buildOrdersWorkbook(orders: OrderRow[]): Uint8Array`，並改寫 `close` 的 `POST` 呼叫之（行為不變、回歸 FR-012）— 見 research.md D5
- [X] T008 [US2] 於 `app/api/orders/selection/route.ts` 新增 `POST` handler：顯式 `auth()`、以 `validateOrderIdsBody` 驗證 ids、`getOrdersByIds(ids)`，若回空陣列回 400「選取的訂單皆已不存在，請重新載入」，否則 `buildOrdersWorkbook` 產生檔案並以 `safeFilename(\`orders_選取_${taipeiDateStamp()}.xlsx\`)` 回應 xlsx（含 `Content-Disposition`）— 見 contracts/export-selected.md（若 `selection/route.ts` 尚未由 T005 建立則於此一併建立，POST 與 DELETE 並存，使 US2 可獨立實作）
- [X] T009 [US2] 於 `app/(admin)/orders/page.tsx` 新增「匯出選取訂單」按鈕（0 勾選時 disabled）：以 `fetch("/api/orders/selection", { method: "POST", body: { ids } })` 取 blob → `downloadBlob`，匯出後**保留**勾選（可重複匯出，FR-004），失敗以 messageApi 提示

**Checkpoint**: US1 + US2 皆可獨立運作；選取匯出與整組匯出格式一致

---

## Phase 5: User Story 3 - 跨頁維持勾選 (Priority: P2)

**Goal**: 勾選在同一路線的表格分頁切換（與「於結果內篩選」）間保留，已選數量涵蓋所有分頁

**Independent Test**: 每頁 10 筆、>10 筆訂單；第 1 頁勾 2 筆、第 2 頁勾 1 筆、翻回第 1 頁仍為勾選，已選數量 3，動作涵蓋全部 3 筆（quickstart 情境 3）

### Implementation for User Story 3

- [X] T010 [US3] 於 `app/(admin)/orders/page.tsx` 的 `rowSelection` 加上 `preserveSelectedRowKeys: true`，使勾選跨分頁與搜尋篩選保留（FR-008），並確認「已選 N 筆」以 `selectedRowKeys.length` 反映所有分頁總數（FR-002）；出貨/匯出動作沿用該集合

**Checkpoint**: 三個 user story 皆可獨立驗收

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 收尾與回歸

- [X] T011 [P] 於 repo root 執行 `npm run lint` 與 `npm run build`，修正型別/lint 問題
- [X] T012 依 `quickstart.md` 逐一驗收情境 1–5 與回歸（FR-012：既有「出貨 / 匯出 CSV」整組入口行為不變、格式一致）
- [X] T013 [P] 檢視 `app/(admin)/orders/page.tsx` 的操作列排版與說明文案，確保新按鈕（出貨選取／匯出選取訂單）與既有「出貨 / 匯出 CSV」整組入口並存不混淆（FR-012）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 無相依，立即開始
- **Foundational (Phase 2)**: 依賴 Setup；**阻擋所有 user story**
- **User Stories (Phase 3–5)**: 皆依賴 Foundational 完成
  - US1 與 US2 皆為 P1，可依序（P1 先）或平行；共用 `app/api/orders/selection/route.ts`（T005 建立、T008 追加 POST）與 `orders/page.tsx`（注意同檔編輯順序）
  - US3 為對既有 `rowSelection` 的小幅升級，建議於 US1/US2 之後
- **Polish (Phase 6)**: 依賴所有欲交付的 user story 完成

### User Story Dependencies

- **US1 (P1)**: Foundational 後即可；不依賴其他 story（單頁勾選即可出貨）
- **US2 (P1)**: Foundational 後即可；T008 需 T007 的 `buildOrdersWorkbook`；`selection/route.ts` 若尚未由 T005 建立則自行建立（POST/DELETE 並存），故 US2 不硬性依賴 US1
- **US3 (P2)**: Foundational 後即可；為 `orders/page.tsx` 的獨立升級，不影響 US1/US2 既有行為

### Within Each User Story

- 資料層/驗證（Foundational）先於端點；端點先於 UI 串接
- 同檔（`orders/page.tsx`、`selection/route.ts`）任務需序列化以免衝突

### Parallel Opportunities

- **Foundational**: T002（`validation.ts`）與 T003（`orders.ts`）為不同檔案，可平行 [P]
- **跨 story**：US1 的端點（T005）與 US2 的 xlsx 抽出（T007）為不同檔案，可平行
- **Polish**: T011 與 T013 可平行 [P]
- 同一檔案的任務（T004/T006/T009/T010 皆改 `orders/page.tsx`；T005/T008 皆改 `selection/route.ts`）**不可**平行

---

## Parallel Example: Foundational

```bash
# 不同檔案、無相依，可同時進行：
Task: "T002 於 app/lib/validation.ts 新增 validateOrderIdsBody"
Task: "T003 於 app/lib/orders.ts 新增 getOrdersByIds / deleteOrdersByIds"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → 2. Phase 2 Foundational（阻擋，務必先完成）→ 3. Phase 3 US1
4. **STOP & VALIDATE**：以 quickstart 情境 1 驗收「勾選出貨」
5. 可交付/展示（單頁勾選出貨即為可用 MVP）

### Incremental Delivery

1. Setup + Foundational → 勾選骨架就緒
2. US1（出貨選取）→ 獨立驗收 → 交付（MVP）
3. US2（匯出選取訂單）→ 獨立驗收 → 交付
4. US3（跨頁保留）→ 獨立驗收 → 交付
5. Polish：lint/build + quickstart 全情境 + 回歸

---

## Notes

- 無 schema 變更、無 migration；金額不採信前端；SQL 一律 tagged template 參數化（`ANY(${ids})`）
- FR-010（部分已消失不整批失敗）由 `getOrdersByIds` / `deleteOrdersByIds` 的 `ANY` + `RETURNING` 天然滿足，無需額外任務
- 每完成一任務或邏輯群組即 commit；於各 Checkpoint 停下獨立驗收
