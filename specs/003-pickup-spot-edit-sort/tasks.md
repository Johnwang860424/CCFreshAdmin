---
description: "Task list for 自取點編輯與排序 (Pickup Spot Edit & Sorting)"
---

# Tasks: 自取點編輯與排序 (Pickup Spot Edit & Sorting)

**Input**: Design documents from `specs/003-pickup-spot-edit-sort/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: 專案無測試框架（plan.md），correctness 以 `npm run lint` + `npm run build` + 手動 quickstart 驗證為準；故**不產生測試任務**。

**Organization**: 任務依使用者故事分組，可獨立實作與驗證。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、無未完成相依）
- **[Story]**: US1 / US2 / US3
- 注意：`app/(admin)/pickup-spots/page.tsx`、`app/lib/pickup-spots.ts`、`app/lib/validation.ts` 為跨故事共用檔案，動到同一檔的任務**不可平行**，須依序進行。

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 確認既有相依與工具就緒（本功能沿用既有專案，無新套件）

- [X] T001 確認 `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/modifiers` 已在 `package.json`（商品排序已用，預期已存在；缺則 `npm install`）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: DB 結構與資料層排序基礎；所有故事都依賴此排序欄位與讀取排序

**⚠️ CRITICAL**: 完成前任何故事都無法正確顯示/排序

- [X] T002 [P] 新增一次性 migration `db/migrations/003_add_pickup_spot_sort_order.sql`：`ALTER TABLE pickup_spots ADD COLUMN sort_order INTEGER`；以 `ROW_NUMBER() OVER (PARTITION BY city ORDER BY id)` 依縣市分群回填；`ALTER COLUMN sort_order SET NOT NULL`；`CREATE INDEX idx_pickup_spots_city_sort ON pickup_spots(city, sort_order)`（內容見 data-model.md）
- [X] T003 [P] 更新 `db/schema.sql`：`pickup_spots` 定義加 `sort_order INTEGER NOT NULL,`，並於檔末 index 區加 `CREATE INDEX idx_pickup_spots_city_sort ON pickup_spots(city, sort_order);`（新環境用）
- [X] T004 在 `app/lib/pickup-spots.ts`：`PickupSpotRow` 介面加 `sortOrder: number`；`getPickupSpots` 的 SELECT 加 `sort_order`、`ORDER BY city, sort_order, id`、map 回傳加 `sortOrder: r.sort_order`
- [X] T005 ⏳ **需使用者操作**：在 Neon 套用 T002 的 migration（於 SQL Editor 執行），並以 `SELECT city, township, sort_order FROM pickup_spots ORDER BY city, sort_order` 驗證每縣市 1..n、無 NULL、無重複。（程式碼依賴此欄存在；未套用前 `/pickup-spots` 讀取會失敗）

**Checkpoint**: 自取點清單已帶 `sortOrder` 並依「縣市→群組內順序」回傳，故事可開始

---

## Phase 3: User Story 1 - 同縣市內拖拉排序 (Priority: P1) 🎯 MVP

**Goal**: 進入排序模式後，清單以縣市分組、可在同縣市群組內拖拉把手調整地點順序，每次拖放即時樂觀儲存，失敗還原

**Independent Test**: 在某縣市群組內拖動地點到新位置放開→畫面立即更新；重新整理後仍維持；嘗試拖到別縣市群組→無法跨群組

### Implementation for User Story 1

- [X] T006 [P] [US1] 在 `app/lib/validation.ts` 新增 `validatePickupReorderBody(body)`：驗證 `city` 為非空字串、`ids` 為非空、皆正整數、不重複的陣列；回傳 `{ value: { city, ids } }` 或 `{ error }`（沿用既有 `validateReorderBody` 風格與「排序資料格式錯誤」訊息）
- [X] T007 [P] [US1] 在 `app/lib/pickup-spots.ts` 新增 `reorderPickupSpots(city: string, ids: number[])`：單語句 `UPDATE pickup_spots ... FROM unnest(${ids}::int[]) WITH ORDINALITY ... WHERE p.id = v.id AND p.city = ${city}`（見 data-model.md / contracts/pickup-spots-reorder.md）
- [X] T008 [US1] 新增 `app/api/pickup-spots/reorder/route.ts`：`PUT` handler，用 `jsonHandler`、`validatePickupReorderBody`，呼叫 `reorderPickupSpots(city, ids)`、`revalidateCache("pickup-spots")`、回 `{ success: true }`（鏡射 `app/api/products/reorder/route.ts`，錯誤訊息「更新自取點排序失敗」）
- [X] T009 [US1] 在 `app/(admin)/pickup-spots/page.tsx` 加入排序 UI 基礎元件：`RowContext`、`DragHandle`、`SortableRow`，並 import `@dnd-kit/*`（鏡射商品頁 `products/page.tsx` 第 44–133 行）
- [X] T010 [US1] 在 `app/(admin)/pickup-spots/page.tsx` 加排序模式狀態與切換：`sortMode`/`reordering` state；「排序」按鈕進入時清空 `search` 並關閉分頁；「完成排序」退出恢復；排序模式下隱藏「操作」欄、列首顯示 `DragHandle`（FR-005/009/010/011）
- [X] T011 [US1] 在 `app/(admin)/pickup-spots/page.tsx` 實作分縣市群組渲染：依 `TAIWAN_LOCATIONS` 索引排序縣市群組；排序模式下每個縣市群組各自一個 `DndContext` + `SortableContext`（`verticalListSortingStrategy` + `restrictToVerticalAxis`/`restrictToParentElement`），群組以縣市標題分隔（FR-006/007/008）
- [X] T012 [US1] 在 `app/(admin)/pickup-spots/page.tsx` 實作 `handleDragEnd`（每縣市）：`arrayMove` 樂觀更新該縣市順序→`putJson("/api/pickup-spots/reorder", { city, ids })`；失敗則還原為拖拉前並 `messageApi.error("排序儲存失敗，已還原順序")`（FR-012/013/014）

**Checkpoint**: US1 可獨立驗證——拖拉排序、即時儲存、刷新保留、禁止跨縣市、失敗還原

---

## Phase 4: User Story 2 - 編輯地點名稱 (Priority: P2)

**Goal**: 可編輯既有自取點的 township（city 唯讀），同縣市重複名稱被拒

**Independent Test**: 對某自取點編輯 township 儲存→列表更新且縣市不變；改成同縣市既有名稱→提示重複；清空→必填擋下

### Implementation for User Story 2

- [X] T013 [P] [US2] 在 `app/lib/pickup-spots.ts` 新增 `class PickupSpotDuplicateError extends Error`（鏡射既有 `PickupSpotInUseError`）與 `updatePickupSpotTownship(id, township)`：`UPDATE pickup_spots SET township = ${township} WHERE id = ${id}`，捕捉 SQLSTATE `23505` → 拋 `PickupSpotDuplicateError`
- [X] T014 [US2] 在 `app/api/pickup-spots/[id]/route.ts` 新增 `PUT` handler：`parseId`、驗證 `township` trim 後非空（否則 400「地點為必填欄位」），呼叫 `updatePickupSpotTownship`，捕捉 `PickupSpotDuplicateError` → 409「同縣市已有相同地點」，成功 `revalidateCache("pickup-spots")`（忽略任何傳入 `city`，見 contracts/pickup-spots-edit.md）
- [X] T015 [US2] 在 `app/(admin)/pickup-spots/page.tsx` 加編輯：列「操作」欄加「編輯」鈕；`editing` state；開 Modal 時帶入現值、city 欄位設為唯讀（disabled）、title 切「編輯自取地點」；`handleSave` 在編輯模式改呼叫 `putJson("/api/pickup-spots/${id}", { township })`，成功提示並 `fetchData`，409/400 顯示後端錯誤訊息（FR-001~004）

**Checkpoint**: US1 與 US2 皆可獨立運作

---

## Phase 5: User Story 3 - 新增排在縣市群組最後 (Priority: P3)

**Goal**: 新增自取點排在其所屬縣市群組最後；既有資料具確定初始順序

**Independent Test**: 在某縣市新增自取點→排序模式檢視該群組→新點在最末。（既有資料初始順序由 Phase 2 migration 保證）

### Implementation for User Story 3

- [X] T016 [US3] 在 `app/lib/pickup-spots.ts` 修改 `addPickupSpot(city, township)`：INSERT 加 `sort_order`，值為 `(SELECT COALESCE(MAX(sort_order),0)+1 FROM pickup_spots WHERE city = ${city})`，使新點排在該縣市群組最後（FR-016）

> 註：FR-017（既有資料初始順序）已由 Phase 2 的 T002/T005 migration 回填達成，無額外任務。

**Checkpoint**: 三個故事皆可獨立運作

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 收尾與驗證

- [X] T017 確認一般模式既有功能未受影響：搜尋、新增、刪除、分頁行為與原樣一致（FR-018，手動檢視 `pickup-spots/page.tsx` 一般模式分支）
- [X] T018 執行 `npm run lint` 與 `npm run build`，修正所有 lint/型別錯誤
- [X] T019 ⏳ **需使用者操作**：依 `specs/003-pickup-spot-edit-sort/quickstart.md` 跑過場景 A/B/C 手動驗證（需 dev server + 已套用 migration 的 DB）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 無相依，可立即開始
- **Foundational (Phase 2)**: 依賴 Setup；**阻擋所有故事**（T004 是排序顯示基礎；T005 須先套 migration）
- **User Stories (Phase 3–5)**: 皆依賴 Phase 2 完成
- **Polish (Phase 6)**: 依賴欲交付的故事完成

### User Story Dependencies

- **US1 (P1)**: Phase 2 後即可開始，無故事間相依
- **US2 (P2)**: Phase 2 後即可開始；與 US1 共用 `page.tsx`/`pickup-spots.ts`，若與 US1 同時進行需協調同檔編輯（建議 US1 完成後再進）
- **US3 (P3)**: Phase 2 後即可開始；僅動 `pickup-spots.ts` 的 `addPickupSpot`，與 US1/US2 邏輯獨立

### 共用檔案的順序限制（不可平行）

- `app/lib/pickup-spots.ts`：T004 → T007 → T013 → T016（同檔，依序）
- `app/(admin)/pickup-spots/page.tsx`：T009 → T010 → T011 → T012 → T015（同檔，依序）
- `app/lib/validation.ts`：T006（單一任務）

### Parallel Opportunities

- T002、T003 可平行（不同檔，純 SQL 檔）
- 跨故事不同檔可平行：T006（validation）與 T007（data 層）可並行起手；惟 T008（API route）依賴 T007，T011/T012 依賴 T009/T010
- T013（pickup-spots.ts）需等 T007 完成（同檔）

---

## Parallel Example: Phase 2 Foundational

```bash
# 可同時進行（不同檔）：
Task T002: "新增 db/migrations/003_add_pickup_spot_sort_order.sql"
Task T003: "更新 db/schema.sql 加 sort_order 與 index"
# 之後再做 T004（pickup-spots.ts），最後 T005（套用 migration 並驗證）
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → Phase 2 Foundational（含套用 migration）
2. Phase 3 US1（拖拉排序）
3. **STOP and VALIDATE**：依 quickstart 場景 A 驗證排序、刷新保留、禁止跨縣市、失敗還原
4. 可交付 / demo

### Incremental Delivery

1. Setup + Foundational → 基礎就緒
2. US1（排序，MVP）→ 驗證 → 交付
3. US2（編輯）→ 驗證 → 交付
4. US3（新增排尾）→ 驗證 → 交付

---

## Notes

- [P] = 不同檔、無相依；共用檔（`page.tsx`/`pickup-spots.ts`/`validation.ts`）任務皆未標 [P]
- 互動全程鏡射商品排序頁 `app/(admin)/products/page.tsx`，降低風險
- 每縣市 reorder 為單語句原子寫入（Neon HTTP 無互動式交易）
- commit 建議以任務或邏輯群組為單位
