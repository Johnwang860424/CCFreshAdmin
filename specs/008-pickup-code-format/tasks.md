# Tasks: 取貨號碼英數格式（站點代碼＋流水號）

**Input**: Design documents from `/specs/008-pickup-code-format/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/pickup-code.md, quickstart.md

**Tests**: 無測試框架（憲法）——不產生測試任務；以 `npm run lint`、`npm run build` 與 quickstart.md 手動場景驗證。

**Organization**: 依 user story 分組；本功能為純顯示層變更（零 schema／零 API／零寫入邏輯變更）。

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

無需設定任務——既有專案、零新依賴、零 schema 變更。

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 建立所有顯示點共用的換算純函式；US1／US2 皆依賴此模組。

- [X] T001 建立 `app/lib/pickup-code.ts`：實作 `spotCodeFromId(id: number): string`（Excel 式雙射 26 進位：1→A、26→Z、27→AA、703→AAA，依 `contracts/pickup-code.md` 值表）與 `formatPickupCode(spotId: number | null, pickupNumber: number | null): string | null`（spotId null → 純數字字串；pickupNumber null → null）。純函式、無 React／無 SQL、附 zh-TW 註解說明衍生規則與「不可改用 sort_order」的約束。

**Checkpoint**: 模組可被 client 與 server 引用，值表與契約一致。

---

## Phase 3: User Story 1 - 取貨號碼跨站點唯一且一眼可辨 (Priority: P1) 🎯 MVP

**Goal**: 訂單管理頁的取貨號欄以「站點代碼＋流水號」（如 A5）顯示；宅配維持純數字；跨站點不重複。

**Independent Test**: 在兩個站點各建一筆自取訂單，清單顯示不同字母開頭的新格式號碼（quickstart 場景 1、3）。

- [X] T002 [US1] 修改 `app/(admin)/orders/page.tsx` 取貨號欄（columns 中 `key: "pickupNumber"` 的 render）：改為 `formatPickupCode(order.pickupSpotId, order.pickupNumber)`，回傳 null 時顯示 `"-"`；Tag 樣式（geekblue、fontSize 16、fontWeight 700）維持不變。確認頁內 `Order` 介面已含 `pickupSpotId`（現為 optional，必要時對齊 `OrderRow` 型別）。
- [X] T003 [US1] 手動驗證 quickstart 場景 1（兩站新格式、同站遞增）與場景 3（宅配純數字）；既有未出貨訂單直接以新格式顯示（FR-009）。＿已於本機以既有資料驗證：兩站分別顯示 L1／H1（跨站字母互異、FR-009 不重編）、宅配清單為純數字；「同站遞增」未實測（需新建訂單寫入正式 DB，指派邏輯本功能未更動）。

**Checkpoint**: 清單顯示即為完整 MVP——現場核對已可用新號碼。

---

## Phase 4: User Story 2 - 清單、彙總與匯出一致採用新格式 (Priority: P2)

**Goal**: 搜尋可用新格式命中；兩個匯出端點（結單、選取匯出）的「取貨號」欄與畫面一致。

**Independent Test**: 搜尋「a1」命中 A1；下載結單 xlsx 與選取匯出 xlsx，「取貨號」欄為新格式（quickstart 場景 2）。

- [X] T004 [US2] 修改 `app/(admin)/orders/page.tsx` 搜尋過濾（`filtered` 中 `String(order.pickupNumber).includes(search)` 一段）：改以 `formatPickupCode(...)` 的結果與輸入雙方 `toLowerCase()` 後 `includes` 比對（`a1`／`A1` 皆命中）；其餘欄位比對邏輯不變。（與 T002 同檔，需在 T002 之後）
- [X] T005 [P] [US2] 修改 `app/lib/order-export.ts` `orderToRow`：「取貨號」欄由 `order.pickupNumber ?? ""` 改為 `formatPickupCode(order.pickupSpotId, order.pickupNumber) ?? ""`；表頭與欄序不動。此一處同時覆蓋 `app/api/orders/close` 與 `app/api/orders/selection` 兩個匯出端點。
- [X] T006 [US2] 手動驗證 quickstart 場景 2（清單/搜尋/兩種匯出一致；大小寫搜尋皆命中）。＿搜尋已驗證（小寫「l1」命中 L1）；xlsx 匯出由使用者驗證完畢（2026-07-10）。

**Checkpoint**: 三個顯示點（清單、搜尋、匯出）一致（SC-002）。

---

## Phase 5: User Story 3 - 出貨清除後號碼重新起算 (Priority: P3)

**Goal**: 確認既有歸零行為在新格式下如預期呈現（本 story 零程式變更——指派邏輯完全未動）。

**Independent Test**: 出貨清除某站點後建新訂單，號碼為「該站代碼＋1」（quickstart 場景 4）。

- [X] T007 [US3] 手動驗證 quickstart 場景 4：對某站點分組執行出貨清除後建立新訂單，取貨號為「該站字母＋1」，字母不變。＿由使用者驗證完畢（2026-07-10）。

**Checkpoint**: 全部 user story 完成。

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T008 [P] 更新 `app/lib/orders.ts` 中 `OrderRow.pickupNumber` 的 doc 註解：補充「顯示時由 `app/lib/pickup-code.ts` 組成站點代碼＋流水號；DB 仍存整數」；`createOrder` 的 JSDoc 若提及「宅配為 NULL」等過時敘述一併校正。
- [X] T009 執行 `npm run lint` 與 `npm run build`，兩者必須通過（憲法 Development Workflow）。＿皆通過（lint 無輸出、build 成功含 TypeScript 檢查）。
- [X] T010 完整跑過 quickstart.md（含場景 5 顧客端相容抽查，如環境可操作）。＿由使用者驗證完畢（2026-07-10）。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 2)**: T001 無前置；**阻擋所有 user story**。
- **US1 (Phase 3)**: T002 依賴 T001。
- **US2 (Phase 4)**: T004 依賴 T001 與 T002（同檔 `orders/page.tsx`）；T005 只依賴 T001。
- **US3 (Phase 5)**: 零程式變更，僅驗證；可在 T002 之後任何時點執行。
- **Polish (Phase 6)**: T008 可隨時；T009／T010 於所有實作任務完成後。

### Parallel Opportunities

- T005（`order-export.ts`）可與 T002／T004（`orders/page.tsx`）平行——不同檔案。
- T008 與任何實作任務平行（僅註解）。

## Parallel Example: T001 完成後

```text
Task A: T002 → T004（orders/page.tsx，依序）
Task B: T005（order-export.ts）
Task C: T008（orders.ts 註解）
```

## Implementation Strategy

**MVP = Phase 2 + Phase 3（T001–T003）**：清單顯示新格式即已消除跨站撞號的核心痛點；搜尋與匯出（US2）緊隨其後補齊一致性；US3 純驗證。單人依 T001→T002→T004→T005→T003/T006/T007→T008→T009→T010 一路做完即可，總量約半天內。
