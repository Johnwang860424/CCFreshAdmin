# Tasks: 站點代碼改為可維護欄位（取貨號碼前綴）

**Input**: Design documents from `/specs/009-editable-spot-code/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/spot-code.md, quickstart.md

> rev. 2026-07-11：回填改為「同路線內依 id 順序 A、B、C…、每路線自 A 起算」；唯一鍵改為 `UNIQUE NULLS NOT DISTINCT (route_id, code)`；放棄切換零感；新增改分路線撞碼驗證。

**Tests**: 無測試框架（憲法）；驗證任務對應 quickstart.md 手動情境 + `npm run lint` / `npm run build`。

**Organization**: 依 user story 分組——US1（P1 號碼改用儲存代碼組成、上線依路線重編）、US2（P2 後台維護代碼）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、無未完成依賴）
- **[Story]**: 所屬 user story（US1、US2）

---

## Phase 1: Setup（Schema 變更）

**Purpose**: 建立並套用 `pickup_spots.code` 欄位與依路線重編回填

- [X] T001 建立 `db/migrations/006_add_pickup_spot_code.sql`：`ALTER TABLE pickup_spots ADD COLUMN code TEXT`（nullable）→ 依 research.md R2 回填（`row_number() OVER (PARTITION BY route_id ORDER BY id)` 轉 Excel 式字母，每路線自 A 起算、NULL 路線自成一組）→ `SET NOT NULL` + `CHECK (code ~ '^[A-Z]{1,3}$')` + 顯式命名 `CONSTRAINT pickup_spots_route_id_code_key UNIQUE NULLS NOT DISTINCT (route_id, code)`
- [X] T002 [P] 同步 `db/schema.sql`：`pickup_spots` 補 `code` 欄定義（含 CHECK 與 `UNIQUE NULLS NOT DISTINCT (route_id, code)`、註解「取貨號前綴，管理員維護，同路線內唯一」）
- [X] T003 於 Neon SQL Editor 手動執行 `db/migrations/006_add_pickup_spot_code.sql`，抽查回填值：每條路線內站點依 id 順序為 A、B、C…且每路線自 A 起算；未分路線群組亦自 A 起算

**Checkpoint**: DB 有 `code` 欄且值符合依路線重編規則

---

## Phase 2: Foundational（資料層讀取）

**Purpose**: 兩個 story 共用的讀取路徑

**⚠️ CRITICAL**: 完成前不得開始任何 user story

- [X] T004 `app/lib/pickup-spots.ts`：`PickupSpotRow` 新增 `code: string`；`getPickupSpots` 的 SELECT 帶 `ps.code` 並 map（data-model.md「TypeScript 型別」）

**Checkpoint**: `GET /api/pickup-spots` 回傳含 `code`——US1、US2 可平行開工

---

## Phase 3: User Story 1 - 取貨號碼改用站點自訂代碼組成（上線依路線重編） (Priority: P1) 🎯 MVP

**Goal**: 取貨號前綴改由 `pickup_spots.code` 供源，完全取代 id 換算；上線時依路線重編（既有訂單前綴改變、流水號不變）。

**Independent Test**: quickstart.md 驗證 1、4——回填後各路線代碼為 A、B、C…；既有訂單顯示「新代碼＋原流水號」；新訂單以站點代碼開頭；宅配純數字；搜尋「k3」命中。

### Implementation for User Story 1

- [X] T005 [US1] `app/lib/orders.ts`：`OrderRow` 新增 `spotCode: string | null`；`getOrders`、`getOrdersByIds`、`getOrdersByRoute`、`getDeliveryOrders`、`getOrderById` 的 SELECT 帶 `ps.code AS spot_code` 並 map（宅配/無站點為 null）
- [X] T006 [P] [US1] `app/lib/pickup-code.ts`：`formatPickupCode` 第一參數改為 `spotCode: string | null`（契約 contracts/spot-code.md §4）；刪除 `spotCodeFromId` 與相關註解，模組註解改述「代碼來自 pickup_spots.code 欄位（管理員維護，同路線內唯一）」
- [X] T007 [US1] `app/(admin)/orders/page.tsx`：取貨號欄 render 與搜尋比對改傳 `order.spotCode`（原 `order.pickupSpotId`）；搜尋維持不分大小寫（depends on T005, T006）
- [X] T008 [P] [US1] `app/lib/order-export.ts`：`orderToRow` 改傳 `order.spotCode`（depends on T005, T006）
- [ ] T009 [US1] 驗證：執行 quickstart.md 驗證 1（依路線重編、既有訂單前綴切換，含匯出檔）與驗證 4（新單組號、宅配、搜尋）；`grep -rn "spotCodeFromId" app/` 無結果（FR-004）

**Checkpoint**: 所有取貨號顯示改由 code 欄供源，US1 可獨立驗收

---

## Phase 4: User Story 2 - 後台維護站點代碼 (Priority: P2)

**Goal**: 自取點管理頁可檢視/新增/修改站點代碼；格式與同路線唯一性驗證；有訂單站點改碼需確認；改分路線撞碼被擋。

**Independent Test**: quickstart.md 驗證 2、3、6——新增/編輯的格式與同路線重複阻擋、跨路線允許同碼、小寫轉大寫、有訂單改碼的確認 Modal、改分路線撞碼提示。

### Implementation for User Story 2

- [X] T010 [P] [US2] `app/lib/validation.ts`：新增 `parseSpotCode`（trim → `toUpperCase()` → `^[A-Z]{1,3}$`；不符回 400「站點代碼須為 1–3 個英文字母」，比照既有 parseRouteId 的回傳慣例）
- [X] T011 [US2] `app/lib/pickup-spots.ts`：`addPickupSpot` 增加 `code` 參數入庫；`updatePickupSpotTownship` 擴充為同時更新 `code`（自取點管理頁用）；`updatePickupSpot`（路線管理頁，改 `route_id`）維持簽名不變但納入同一錯誤分流；新增 `SpotCodeDuplicateError`（「同路線已有相同代碼的站點」）；23505 依 `err.constraint` 分流（`pickup_spots_route_id_code_key` → 新錯誤；`pickup_spots_city_township_key` → 既有 `PickupSpotDuplicateError`，research.md R5/R8）；新增 `countOrdersBySpot(id)`（供兩段式確認）
- [X] T012 [P] [US2] `app/api/pickup-spots/route.ts`：POST 必填 `code`，經 `parseSpotCode` 驗證後傳入 `addPickupSpot`；`SpotCodeDuplicateError` → 409（契約 §2）（depends on T010, T011）
- [X] T013 [US2] `app/api/pickup-spots/[id]/route.ts`：PUT 接受 `code` 與 `confirmCodeChange`——code 有變 ∧ 站點尚有訂單 ∧ 未確認 → `409 { requiresConfirmation: true, orderCount, error }`；已確認或無訂單 → 更新；`SpotCodeDuplicateError` → 409（同時涵蓋改分路線撞碼，契約 §3、FR-008）（depends on T010, T011）
- [X] T014 [US2] `app/(admin)/pickup-spots/page.tsx`：表格新增「代碼」欄；新增/編輯表單加代碼輸入（必填、pattern、輸入自動轉大寫）；PUT 收到 `requiresConfirmation` → `Modal.confirm`（顯示 orderCount 警語）→ 確認後帶 `confirmCodeChange: true` 重送（depends on T012, T013）
- [ ] T015 [US2] 驗證：執行 quickstart.md 驗證 2（格式/同路線重複/跨路線同碼/大寫）、驗證 3（有訂單改碼確認、取消不變、確認後 C5→D5）與驗證 6（改分路線撞碼被擋、改碼後可移動；路線管理頁預期零改動，若既有錯誤顯示未呈現 409 訊息才補）

**Checkpoint**: US1 + US2 皆可獨立運作

---

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T016 [P] 更新 `CLAUDE.md` Data layer 段落：取貨號前綴描述由「id 換算」改為「pickup_spots.code 欄位（管理員維護、同路線內唯一、UNIQUE NULLS NOT DISTINCT (route_id, code)）」
- [X] T017 `npm run lint` 與 `npm run build` 全數通過
- [ ] T018 完整跑過 `specs/009-editable-spot-code/quickstart.md` 全部驗證（含驗證 5 顧客端不中斷）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1（Setup）**: 無依賴；T003 依賴 T001
- **Phase 2（Foundational）**: 依賴 Phase 1 完成——阻擋所有 user story
- **Phase 3（US1）/ Phase 4（US2）**: 皆僅依賴 Phase 2，兩者可平行
- **Phase 5（Polish）**: 依賴 US1 + US2 完成

### User Story Dependencies

- **US1 (P1)**: Foundational 後即可開始；不依賴 US2
- **US2 (P2)**: Foundational 後即可開始；不依賴 US1（代碼維護與號碼顯示切換互不阻擋）

### Within Each Story

- US1：T005/T006 → T007/T008 → T009
- US2：T010/T011 → T012/T013 → T014 → T015

### Parallel Opportunities

- T001 ∥ T002（不同檔案）
- Phase 2 後：US1 全段 ∥ US2 全段
- US1 內：T005 ∥ T006；T007 ∥ T008
- US2 內：T010 ∥ T011；T012 ∥ T013
- T016 可與任一驗證任務平行

---

## Parallel Example: Foundational 完成後

```bash
# 兩個 story 同時開工：
Task: "T005 [US1] app/lib/orders.ts OrderRow.spotCode + 五個查詢帶 ps.code"
Task: "T006 [US1] app/lib/pickup-code.ts formatPickupCode 改吃 spotCode"
Task: "T010 [US2] app/lib/validation.ts parseSpotCode"
Task: "T011 [US2] app/lib/pickup-spots.ts 寫入路徑 + 錯誤分流"
```

---

## Implementation Strategy

### MVP First（US1 only）

1. Phase 1 → Phase 2（⚠️ T003 執行當下既有訂單前綴即改變——建議選在**非出貨作業時段**執行，並與現場同步「以新號碼為準」）
2. Phase 3（US1）→ quickstart 驗證 1、4 → 可部署

### Incremental Delivery

1. Setup + Foundational → DB 與讀取就緒
2. US1 → 顯示切換至新代碼 → 部署（MVP）
3. US2 → 代碼可維護（本功能的新增價值）→ 部署
4. Polish → 文件與整體驗證

### 上線時序注意

- Migration（T003）與 US1 程式部署之間，畫面仍以舊 id 換算顯示（尚未讀 code 欄）——兩者間隔越短越好，建議同一維護窗口內先跑 migration、隨即部署。

---

## Notes

- 無測試框架：每個 story 的最後一個任務即該 story 的手動驗收（quickstart 對應段落）
- T003 為手動 DB 作業（Neon SQL Editor），與憲法「schema 手動執行 + PR 說明遷移步驟」一致
- 提交建議：Phase 1+2 一個 commit；US1、US2 各一個 commit；Polish 併入最後 commit
