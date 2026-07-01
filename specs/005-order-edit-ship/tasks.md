---
description: "Task list for 訂單修改、刪除與出貨/CSV 分離"
---

# Tasks: 訂單修改、刪除與出貨/CSV 分離

**Input**: Design documents from `specs/005-order-edit-ship/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: 未要求（專案無測試框架，非 TDD）。以 `npm run lint` + `npm run build` + quickstart.md 手動驗證把關。故不產生測試任務。

**Organization**: 依使用者故事分階段（US1 P1 → US2 P2 → US3 P2）。各故事可獨立實作與驗證。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、彼此無依賴）
- **[Story]**: 對應 spec.md 使用者故事（US1/US2/US3）

## 重要前提

- **無 schema 變更、無 migration**（data-model.md）。沿用既有 `orders` / `order_items`。
- 所有新 SQL 一律寫在 `app/lib/orders.ts`，以 `sql` tagged template 參數化（憲章原則 II）。
- 變更資料端點（PUT/DELETE）於 handler 內顯式 `auth()`（憲章原則 III）。
- `app/(admin)/orders/page.tsx` 為三個故事共用檔，前端任務彼此**不可平行**（同檔）。

---

## Phase 1: Setup

**Purpose**: 確認起點與範圍

- [X] T001 檢視 `specs/005-order-edit-ship/` 設計文件並確認無需 DB schema/migration；於 repo root 執行 `npm run dev` 確認可啟動、`/orders` 可載入。

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 治理前提——本功能會就地編輯/刪除既有訂單列，與憲章原則 V 現行字面衝突，須先取得授權方可進行。

**⚠️ CRITICAL**: 完成後才開始各使用者故事。

- [X] T002 [P] 修訂 `.specify/memory/constitution.md` 原則 V：重新定義為「**出貨（清帳）前訂單為可修改工作資料；出貨為不可逆清帳邊界**」，保留快照於寫入時建立並保存、參照完整性 `ON DELETE RESTRICT/CASCADE` 等約束；版號 MINOR bump 並補 Sync Impact Report（見 research.md D5、plan Complexity Tracking）。
- [X] T003 [P] 更新 `CLAUDE.md` Data layer 段落：說明 orders/order_items 於出貨前可由後台**修改/刪除**（不再是「僅讀取/匯出/清除」），並補記 `app/api/orders/[id]` 端點與 `orders.ts` 新增函式 `getOrderById`/`updateOrderItems`/`deleteOrder`。

**Checkpoint**: 治理就緒，US1/US2/US3 可開始。

---

## Phase 3: User Story 1 - 修改訂單品項（追加／減少） (Priority: P1) 🎯 MVP

**Goal**: 管理員可對既有訂單新增／移除明細、改數量；儲存後總額重算。既有明細保留原始快照（改量以原快照重算），新增明細用商品現價快照。

**Independent Test**: 對一筆含 2 項明細的訂單新增一項、另一項數量改 2、移除一項 → 儲存後展開可見更新後明細與總額（=各小計加總）；數量 0/空 或清為 0 項被擋並提示。

### Implementation for User Story 1

- [X] T004 [P] [US1] 於 `app/lib/validation.ts` 新增 `validateUpdateOrderItemsBody`：`items` 非空；每列 `quantity` 正整數；每列恰有 `id`（正整數）或 `productId`（正整數）其一；合併重複 `id`/`productId` 的數量；忽略金額欄位。回傳 `{ value: { items: {id?, productId?, quantity}[] } }` 或 400（訊息見 contracts/put-order.md）。
- [X] T005 [P] [US1] 於 `app/lib/orders.ts` 新增 `getOrderById(id)`：以既有 JOIN 取單筆訂單＋明細（含 `order_items.id`、快照欄位），無則回 `null`。
- [X] T006 [US1] 於 `app/lib/orders.ts` 新增 `updateOrderItems(id, items)`（依賴 T005）：載入既有明細快照；對帶 `id` 列驗證屬本訂單並套「原快照＋新量」以 `calcLineSubtotal` 重算 subtotal；對帶 `productId` 列查 `products` 取現值快照計算 subtotal（不存在拋 `OrderInputError`）；`total = Σ subtotal`；以**單一 CTE**（`DELETE order_items WHERE order_id` + `INSERT ... SELECT ... FROM unnest(...)` + `UPDATE orders SET total ... RETURNING id`）原子替換，`upd` 無回列回 `null`（訂單不存在）。回傳更新後訂單或 `null`。
- [X] T007 [US1] 建立 `app/api/orders/[id]/route.ts` 並實作 `PUT`（依賴 T004、T006）：`auth()` 守衛 → `parseId` → `validateUpdateOrderItemsBody` → `updateOrderItems`；`OrderInputError`/`id 不屬本訂單`→400、`null`→404、成功回更新後訂單。以 `jsonHandler` 包裝。
- [X] T008 [US1] 於 `app/(admin)/orders/page.tsx` 新增「操作」欄位與「編輯」按鈕，開啟編輯 Modal（依賴 T007）：以該列 `record.items` 帶入 `Form.List` 現有明細（保留其 `order_items.id`）、可移除、可改量；新增列的商品選單取自 `/api/products`（沿用建立訂單既有載入）；送出經 `putJson('/api/orders/'+id, { items })`；成功後 `fetchRouteOptions()` 並刷新目前分組清單。
- [X] T009 [US1] 於 `app/(admin)/orders/page.tsx` 補編輯 Modal 的前端驗證與 UX（依賴 T008）：擋空明細（提示改用刪除）、擋數量非正整數、顯示即時預估總額；錯誤以 `messageApi` 顯示後端訊息。

**Checkpoint**: US1 可獨立運作——編輯品項並正確重算總額。此為 MVP。

---

## Phase 4: User Story 2 - 刪除單筆訂單 (Priority: P2)

**Goal**: 管理員可刪除清單中任一筆訂單（含二次確認），明細一併清除，不影響其他訂單。

**Independent Test**: 對某筆按刪除→取消（不變）；再刪除→確認（消失、其他筆不變）；重載後仍不存在。

### Implementation for User Story 2

- [X] T010 [US2] 於 `app/lib/orders.ts` 新增 `deleteOrder(id)`：`DELETE FROM orders WHERE id = ${id}`（明細由 `ON DELETE CASCADE` 清除），回傳是否刪到（rowCount>0）。
- [X] T011 [US2] 於 `app/api/orders/[id]/route.ts` 新增 `DELETE`（依賴 T010；若 T007 尚未建立此檔則一併建立）：`auth()` → `parseId` → `deleteOrder`；rowCount=0 回 404，成功回 `{ success: true }`。
- [X] T012 [US2] 於 `app/(admin)/orders/page.tsx` 在「操作」欄加「刪除」按鈕（若欄位尚未存在則建立）：以 `modal.confirm` 二次確認（危險樣式）→ `deleteJson('/api/orders/'+id)`；成功後 `fetchRouteOptions()` 並刷新目前分組清單、以 `messageApi` 回饋。

**Checkpoint**: US1 與 US2 各自可獨立運作。

---

## Phase 5: User Story 3 - 出貨（清除）與 CSV 匯出分離 (Priority: P2)

**Goal**: 「結單」更名「出貨」（只清除分組、不下載 CSV）；「匯出 CSV」為獨立按鈕（只下載、不清資料、可重複）。

**Independent Test**: 對某分組按「匯出 CSV」→ 取檔且筆數不變、可重複；按「出貨」→ 不可復原確認→清除該分組且過程無任何下載；空分組不提供可執行動作或提示無資料。

### Implementation for User Story 3

- [X] T013 [US3] 於 `app/(admin)/orders/page.tsx` 將結單流程改為「出貨」：把 `handleCloseGroup`/`closeGroup` 改為**只呼叫** `DELETE /api/orders/close`（移除先 POST 下載 CSV 再 DELETE 的串接與 `downloadBlob`）；主按鈕與 Modal 內按鈕文案改「出貨」，確認對話框維持不可復原提示（FR-016）。
- [X] T014 [US3] 於 `app/(admin)/orders/page.tsx` 結單 Modal 每組新增獨立「匯出 CSV」動作（依賴 T013）：**只呼叫** `POST /api/orders/close` 取得 CSV 並 `downloadBlob`（不刪任何資料，可重複）；更新 Modal 文案，移除「下載成功後才清除」等綁定敘述；空分組時停用或提示無資料。
- [X] T015 [US3] 於 `app/api/orders/close/route.ts`：(a) 為 `POST`（匯出）與 `DELETE`（出貨）補顯式 `auth()`（憲章原則 III 縱深防禦）；(b) 將空分組 400 訊息由「此分組目前沒有訂單可結單」改為中性「此分組目前沒有訂單」（同時適用匯出與出貨，去除殘留「結單」字樣）；(c) 確認 CSV 欄位與電話文字化（Excel 文字公式）未變（FR-018）。

**Checkpoint**: 三個故事皆可獨立運作；出貨與匯出互不觸發（SC-004）。

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: 收尾與把關

- [X] T016 於 repo root 執行 `npm run lint` 與 `npm run build`，修正型別/規則問題（憲章開發流程要求）。
- [ ] T017 依 `specs/005-order-edit-ship/quickstart.md` 手動驗證 US1/US2/US3 全流程（含邊界與並發「訂單不存在」提示）。
- [X] T018 [P] PR 前對照憲章逐項自審：原則 II（SQL 全參數化）、III（PUT/DELETE 皆 `auth()`）、V（已修訂）；於 PR 描述載明原則 V 修訂與偏離理由。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1)**：無依賴，可先做。
- **Foundational (P2)**：治理前提，建議先於程式碼變更完成（授權偏離）。T002、T003 可平行。
- **User Stories (P3–P5)**：foundational 後可進行；US1/US2/US3 邏輯上互相獨立，但**共用 `page.tsx` 與 `[id]/route.ts`**，實務上前端與同檔任務需序列化。
- **Polish (P6)**：所有目標故事完成後。

### 檔案層級依賴（同檔序列）

- `app/lib/orders.ts`：T005 → T006（T006 依賴 T005）；T010 獨立函式但與 T005/T006 同檔，避免同時編輯。
- `app/api/orders/[id]/route.ts`：T007（建立＋PUT）先，T011（DELETE）後補；若先做 US2，T011 需建立此檔，T007 改為補 PUT。
- `app/(admin)/orders/page.tsx`：T008 → T009 → T012 → T013 → T014（同檔，序列）。「操作」欄由先執行者建立，後者沿用。

### 使用者故事獨立性

- US1（P1）：完成即為可交付 MVP（編輯品項）。
- US2（P2）：可於 foundational 後獨立完成（刪除）。
- US3（P2）：純前端串接重整＋後端 auth 補強，可獨立完成。

### Parallel Opportunities

- T002 ‖ T003（不同檔）。
- T004 ‖ T005（`validation.ts` ‖ `orders.ts` 不同檔）。
- 若多人：US2 的 `deleteOrder`（orders.ts）與 US3 的 `close/route.ts`、`page.tsx` 前端可分工，但注意 `orders.ts`、`page.tsx`、`[id]/route.ts` 的同檔衝突。

---

## Parallel Example: User Story 1 起手

```bash
# 可同時進行（不同檔）：
Task: "T004 validateUpdateOrderItemsBody in app/lib/validation.ts"
Task: "T005 getOrderById in app/lib/orders.ts"
# 之後：T006（依 T005）→ T007（依 T004,T006）→ T008 → T009
```

---

## Implementation Strategy

### MVP First（僅 US1）

1. Phase 1 Setup → 2. Phase 2 Foundational（含修憲 T002）→ 3. Phase 3 US1 → 4. **停下驗證** US1（編輯品項＋總額）→ 可展示。

### Incremental Delivery

1. Setup + Foundational → 治理與基礎就緒。
2. US1（編輯）→ 獨立驗證 → MVP。
3. US2（刪除）→ 獨立驗證。
4. US3（出貨/CSV 分離）→ 獨立驗證。
5. Polish：lint/build + quickstart + 憲章自審。

---

## Notes

- [P] = 不同檔、無依賴。
- 金額一律後端計算；既有明細改量用**原快照**、新增用**商品現價**（FR-008/009）。
- 原子性以單一 CTE 達成（Neon HTTP 無互動式交易），比照既有 `createOrder`。
- 每完成一任務或邏輯群組即 commit；於各 checkpoint 可獨立驗證故事。
