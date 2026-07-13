# Tasks: 重複下訂快速篩選

**Input**: Design documents from `/specs/011-duplicate-order-filter/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/duplicate-filter-ui.md, quickstart.md

**Tests**: 未要求測試任務（專案無測試框架，憲法規定以 lint／build／quickstart 手動驗證把關）。

**Organization**: 依 user story 分組。本功能極小——唯一邏輯異動點是 `app/(admin)/orders/page.tsx`（同檔任務須依序執行，不可平行），另有 `app/globals.css` 一段樣式。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、無未完成依賴）
- **[Story]**: 所屬 user story（US1、US2）

## Phase 1: Setup

**Purpose**: 建立工作分支（無其他初始化需求——零依賴新增、零 schema 變更）

- [X] T001 從 `main` 建立並切換至分支 `feature/duplicate-order-filter`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 兩個 user story 共用的判定核心——客戶識別鍵與重複鍵集合（US1 篩選與 US2 標記都吃它）

**⚠️ CRITICAL**: 此階段完成前，US1/US2 均無法開工

- [X] T002 在 `app/(admin)/orders/page.tsx` 新增判定核心（依 data-model.md／contracts C1–C2）：
  - module 層 helper `orderKey(order)`：`order.customerName.trim()` 為鍵；trim 後為空回傳 `null`＝不參與判定（2026-07-13 第二次修訂：僅相同姓名算重複，電話完全不比對——前兩版規則作廢）
  - `dupKeys = useMemo<Set<string>>`：以 `data` 為母體單趟 Map 計數（略過鍵為 null 者），收集出現次數 > 1 的鍵（依賴陣列僅 `[data]`——不得依賴 `search`／開關狀態，FR-002）
  - `dupCount = useMemo<number>`：`data` 中鍵非 null 且命中 `dupKeys` 的訂單筆數（以訂單計，US1-AS2）；另設 `isDup(order)` helper 供 filtered 與客戶欄標籤共用

**Checkpoint**: `orderKey`／`dupKeys`／`dupCount` 可用——US1、US2 可開始

---

## Phase 3: User Story 1 - 一鍵篩選出重複下訂的訂單 (Priority: P1) 🎯 MVP

**Goal**: 搜尋框旁「只看重複下訂（N 筆）」開關；開啟後列表僅剩重複訂單且同客戶相鄰，統計卡／全選／勾選出貨與匯出自動套用篩選結果

**Independent Test**: 同路線建立甲（同電話含空白變體）2 筆＋乙 1 筆 → 開關顯示（2 筆）；開啟後僅剩甲兩筆且相鄰、總金額卡與全選僅涵蓋這兩筆；關閉即回復（quickstart B／C）

### Implementation for User Story 1

- [X] T003 [US1] 在 `app/(admin)/orders/page.tsx` 新增 `dupOnly` state（`useState(false)`，切換路線不重設——research R7），並於 actions 列搜尋框 `Input`（現約 `page.tsx:760`）旁加 antd `Checkbox`：文字「只看重複下訂（{dupCount} 筆）」、`checked={dupOnly}`、`disabled={dupCount === 0}`（contracts C3）；未選路線時 `data` 為空 → `dupCount` 為 0 → 自然 disabled，即 FR-009 的達成方式，無需另行判斷
- [X] T004 [US1] 修改 `app/(admin)/orders/page.tsx` 既有 `filtered` 產生式（現約 `page.tsx:412`）：既有搜尋條件 AND `(!dupOnly || dupKeys.has(orderKey(order)))`——不得另建平行清單，讓 `routeTotal`／`stationTotals`／`filteredKeys`（表頭全選）／`dataSource`／「篩選結果共 N 筆」零改動繼承（FR-004／FR-005，research R3）
- [X] T005 [US1] 在 `app/(admin)/orders/page.tsx` 為 `filtered` 加上「僅 `dupOnly` 開啟時」的相鄰排序：以「鍵首次出現於 `data` 的索引」為組序做穩定排序（組內維持原相對順序；未開啟時完全不動排序）（FR-006，research R4）
- [X] T006 [US1] 依 quickstart.md 場景 B（開關／筆數／交集／回復）與 C（總金額卡、站點統計、表頭全選、匯出選取、勾選出貨）手動驗證 US1 全部驗收場景，含（0 筆）disabled 與未選路線空狀態（FR-009）

**Checkpoint**: US1 獨立可用——即為 MVP

---

## Phase 4: User Story 2 - 未開篩選也能一眼看見重複訂單 (Priority: P2)

**Goal**: 重複下訂的訂單列以警示黃背景恆常標記，不受開關與搜尋影響

**Independent Test**: 不開篩選瀏覽列表，重複的每一筆列有黃底、其他列無；搜尋縮小結果後標記仍在；刪到剩單筆後標記消失（quickstart A／D）

### Implementation for User Story 2

- [X] T007 [P] [US2] ~~在 `app/globals.css` 新增 `.dup-order-row` 背景色樣式~~（已依使用者裁決改為客戶欄標籤——本任務作廢，樣式已移除）
- [X] T008 [US2] 在 `app/(admin)/orders/page.tsx` 的「客戶」欄 `render`：命中 `dupKeys` 時於姓名後附橙色 `<Tag color="orange">重複</Tag>`；不得動 `rowKey`／`rowSelection`／`expandable`／`pagination`（contracts C5/C6；原 rowClassName 背景色方案已依使用者裁決移除）
- [X] T009 [US2] 依 quickstart.md 場景 A（標記正確性、丁不被誤標、搜尋後標記仍在）與 D（刪單後重算、切換路線重算、宅配視圖）手動驗證 US2 全部驗收場景

**Checkpoint**: US1、US2 皆獨立可用

---

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T010 `npm run lint` 與 `npm run build` 全數通過（TS strict）
- [X] T011 執行 quickstart.md 完整 A–E 驗證（含邊界 E：0 筆 disabled、未選路線、純空白電話退回姓名），確認既有行為零迴歸（分頁、展開列、勾選跨頁保留、切換路線清空勾選），完成後清除測試訂單

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1（Setup）**: 無依賴
- **Phase 2（Foundational）**: 依賴 T001——**阻塞 US1 與 US2**
- **Phase 3（US1）**: 依賴 T002
- **Phase 4（US2）**: 依賴 T002（不依賴 US1——T007/T008 只用 `dupKeys`／`orderKey`）
- **Phase 5（Polish)**: 依賴所有欲交付的 story 完成

### User Story Dependencies

- **US1 (P1)**: Foundational 後即可開工，不依賴 US2
- **US2 (P2)**: Foundational 後即可開工，不依賴 US1（兩者可獨立交付與驗證）

### Within Each Story

- US1：T003 → T004 → T005（同檔 `page.tsx`，依序）→ T006 驗證
- US2：T007 與 T008 可平行（不同檔案）→ T009 驗證

### Parallel Opportunities

- 唯一可平行組：**T007（globals.css）∥ T008（page.tsx）**——其餘任務全部落在 `app/(admin)/orders/page.tsx` 同一檔案，必須依 Task ID 順序執行。
- 若兩人分工：Foundational（T002）完成後，A 做 US1（T003–T006）、B 做 US2（T007–T009）——US2 的 T008 與 US1 的 T003–T005 同檔，需協調合併順序（建議單人依序做完，總量本就極小）。

## Parallel Example: User Story 2

```bash
# T007 與 T008 為不同檔案、共同依賴 T002，可同時進行：
Task: "在 app/globals.css 新增 .dup-order-row 樣式（含 hover 態）"
Task: "在 app/(admin)/orders/page.tsx 的 Table 加 rowClassName"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 → T002（Foundational）
2. T003–T005 實作、T006 驗證 → **STOP and VALIDATE**：US1 即為可交付 MVP（可先出 PR）
3. 視需要再加 US2（T007–T009）

### Incremental Delivery

1. Setup + Foundational → 判定核心就緒
2. US1 → 獨立驗證 → 可交付（MVP）
3. US2 → 獨立驗證 → 可交付
4. Polish（T010–T011）→ lint/build/quickstart 全過後合併

## Notes

- 全功能僅動 2 個檔案（`app/(admin)/orders/page.tsx`、`app/globals.css`），零 DB／零 API／零新依賴
- 同檔任務刻意拆小以對應 spec FR 逐條可追溯：T003↔FR-003、T004↔FR-004/005、T005↔FR-006、T007+T008↔FR-007、T002↔FR-001/002
- 驗證以 quickstart.md 為準（無測試框架）；每個 checkpoint 皆可獨立停下驗收
