---
description: "Task list for 後台新增訂單與來源標籤"
---

# Tasks: 後台新增訂單與來源標籤

**Input**: Design documents from `specs/002-admin-order-creation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/orders-api.md

**Tests**: 本專案未配置測試框架，規格亦未要求 TDD，故不產生自動化測試任務；正確性以 `npm run lint`、`npm run build`（型別）與 quickstart.md 手動驗證為準。

**Organization**: 任務依使用者故事分組，US1（建立訂單）為 MVP，US2（來源標籤）為增量。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、無未完成相依）
- **[Story]**: 所屬使用者故事（US1 / US2）
- 每個任務含明確檔案路徑

## Path Conventions

Next.js App Router 單一專案，路徑相對於 repo 根目錄（`app/`、`db/`）。

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 功能所需的 schema 檔案變更

- [X] T001 在 `db/schema.sql` 的 `CREATE TABLE orders` 定義中加入 `tag TEXT NOT NULL DEFAULT '網站'` 欄位（含對齊現有註解風格），並於 PR 說明 migration 步驟
- [X] T001b 新增既有環境一次性 migration `db/migrations/002_add_order_tag.sql`：`ALTER TABLE orders ADD COLUMN tag TEXT NOT NULL DEFAULT '網站';`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 阻擋所有故事的前置；`orders.tag` 欄位必須先存在，建立／讀取訂單才能運作

**⚠️ CRITICAL**: 完成本階段前，US1／US2 皆無法實作

- [ ] T002 ⚠️ 需手動：對 Neon 資料庫套用 migration `db/migrations/002_add_order_tag.sql`（必要時補 `UPDATE orders SET tag = '網站' WHERE tag IS NULL;`），參照 quickstart.md 前置步驟。**未由本工具執行（避免對正式 DB 做不可逆變更）**

**Checkpoint**: 資料表已具備 `tag` 欄位，可開始實作使用者故事

---

## Phase 3: User Story 1 - 後台手動建立訂單 (Priority: P1) 🎯 MVP

**Goal**: 管理員可於訂單管理頁透過「新增訂單」表單建立一筆訂單（自取／宅配、多項商品、備註），訂單與顧客端訂單並列，可查詢、展開明細並隨分組結單匯出。來源此階段一律採預設「網站」。

**Independent Test**: 開啟新增訂單表單，填入一筆含 2 項商品（其一帶促銷）的自取訂單並送出 → 於對應縣市/地點查得該訂單、總額與明細小計正確、取得取貨號碼牌、可隨分組結單匯出。

### Implementation for User Story 1

- [X] T003 [P] [US1] 在 `app/lib/validation.ts` 新增 `validateCreateOrderBody(body)`：驗證 `customerName`（trim 非空）、`deliveryMethod`（pickup/delivery）、`items`（非空、每項 `productId` 正整數、`quantity` 正整數、重複 productId 合併數量）、pickup 時 `pickupSpotId` 必填、delivery 時 `shippingAddress` 非空；`tag` 選填且須為 `網站/FB/Line`、未給回填 `網站`；回傳已正規化結構或 `{ error: NextResponse(400) }`（沿用既有 `badRequest` 風格）
- [X] T004 [P] [US1] 在 `app/lib/orders.ts` 新增 `createOrder(input)`：以 `productId` 即時查 `products` 取得 `name/price/promo_type/promo_config`（缺商品則回報錯誤）、用 `calcLineSubtotal()` 算各項 `subtotal` 並加總為 `total`；自取時以 `COALESCE(MAX(pickup_number),0)+1`（依 `pickup_spot_id`）指派號碼、撞 `UNIQUE` 時有限次重試，宅配為 NULL；以**單一 CTE SQL 語句**（`WITH new_order AS (INSERT ... RETURNING id) INSERT INTO order_items ... SELECT ... FROM new_order, unnest(...)`）原子寫入 `orders` 與 `order_items`；接受 `tag`（預設 `網站`）；回傳新訂單 `id`
- [X] T005 [US1] 在 `app/api/orders/route.ts` 新增 `POST` handler（沿用 `jsonHandler`，錯誤訊息「新增訂單失敗」）：先呼叫 `auth()`，未授權回 401；解析 body、以 `validateCreateOrderBody`（T003）驗證、呼叫 `createOrder`（T004），成功回 `{ success: true, id }`（依賴 T003、T004）
- [X] T006 [US1] 在 `app/(admin)/orders/page.tsx` 新增「新增訂單」按鈕與 Modal＋antd `Form` 骨架：客戶姓名（必填）、電話（選填）、取貨方式切換（自取／宅配）、備註欄位，及開關 Modal 的狀態
- [X] T007 [US1] 在 `app/(admin)/orders/page.tsx` 表單載入商品與取貨點清單（`GET /api/products`、`GET /api/pickup-spots`），依取貨方式條件顯示「取貨點 Select」或「宅配地址」欄位；當無可用取貨點時，停用自取或提示先建立取貨點（FR-011）
- [X] T008 [US1] 在 `app/(admin)/orders/page.tsx` 以 `Form.List` 實作商品明細（商品 Select ＋數量 InputNumber，至少一項、數量為正整數），並以共用 `calcLineSubtotal()` 即時顯示預估總額
- [X] T009 [US1] 在 `app/(admin)/orders/page.tsx` 實作送出處理：`POST /api/orders`，成功時 `message` 提示、關閉 Modal、重設表單並重新整理清單與縣市/地點清單（`fetchOrders`/`fetchLocations`）；失敗時顯示後端錯誤訊息

**Checkpoint**: US1 可獨立運作——能新增自取／宅配訂單，於清單查得並結單匯出（來源預設「網站」）

---

## Phase 4: User Story 2 - 標記訂單來源 (FB / Line) (Priority: P2)

**Goal**: 新增訂單時可選來源「FB」或「Line」（預設「網站」），清單顯示來源標籤，未指定者顯示「網站」，並於結單 CSV 匯出。

**Independent Test**: 各建立一筆來源「FB」與「Line」的訂單 → 清單分別顯示對應標籤；檢視顧客端／預設訂單顯示「網站」；結單 CSV 含正確「來源」欄。

**Note**: 表單來源欄位（T012）與清單顯示建立在 US1 的表單與清單之上；故 US2 在表單層面相依 US1。`createOrder`（T004）已接受 `tag`，US2 僅需把表單選值送入。

### Implementation for User Story 2

- [X] T010 [P] [US2] 在 `app/lib/orders.ts` 為 `OrderRow` 介面新增 `tag: string`，並於 `assembleOrders` 把 `r.tag` 映射到結果
- [X] T011 [US2] 在 `app/lib/orders.ts` 將 `o.tag` 加入 `getOrders`、`getOrdersByLocation`、`getDeliveryOrders` 的 `SELECT` 欄位（依賴 T010，同檔案）
- [X] T012 [US2] 在 `app/(admin)/orders/page.tsx` 的新增訂單表單加入「來源」Select（選項：網站／FB／Line，預設「網站」），並在送出 body 帶入 `tag`（建立在 T006 表單之上）
- [X] T013 [US2] 在 `app/(admin)/orders/page.tsx` 訂單清單表格新增「來源」欄，以 antd `Tag` 呈現 `record.tag`（依賴 T011 使資料含 tag）
- [X] T014 [P] [US2] 在 `app/api/orders/close/route.ts` 的 CSV 匯出 `header` 與每列加入「來源」欄（輸出 `order.tag`），欄位置於「客戶姓名」後

**Checkpoint**: US1 與 US2 皆可運作——可標記並顯示／匯出來源，預設「網站」正確套用

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: 收尾與跨故事驗證

- [X] T015 執行 `npm run lint` 與 `npm run build`，修正所有 lint／型別錯誤（皆通過）
- [X] T016 ⚠️ 需手動：依 `specs/002-admin-order-creation/quickstart.md` 執行 S1–S6 手動驗證（含原子性 S5、CSV 含來源 S6）— 需先完成 T002 並啟動 dev server

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 無相依，可立即開始
- **Foundational (Phase 2)**: 依賴 Setup（schema 檔案）；**阻擋所有使用者故事**
- **User Story 1 (Phase 3)**: 依賴 Foundational 完成
- **User Story 2 (Phase 4)**: 依賴 Foundational；表單與清單部分相依 US1（T012/T013 建於 T006/T011 之上）；CSV（T014）與型別/查詢（T010/T011）可在 US1 完成前獨立進行
- **Polish (Phase 5)**: 依賴所欲交付的故事完成

### Within Each User Story

- US1：T003、T004 可平行 → T005（POST）依賴兩者；T006→T007→T008→T009 為同一檔案 `page.tsx` 的順序工作
- US2：T010→T011 同檔順序；T012→T013 同檔順序（且相依 US1 表單/清單）；T014 獨立

### Parallel Opportunities

- T003、T004（不同檔案：`validation.ts` vs `orders.ts`）可平行
- T010 與 T014（不同檔案）可平行，且可與 US1 後端任務平行推進
- 注意：`app/lib/orders.ts`（T004 vs T010/T011）與 `app/(admin)/orders/page.tsx`（T006–T009 vs T012/T013）為跨故事共用檔案，跨故事時須順序進行以免衝突

---

## Parallel Example: User Story 1

```bash
# US1 後端可平行啟動（不同檔案）：
Task: "validateCreateOrderBody in app/lib/validation.ts"   # T003
Task: "createOrder() in app/lib/orders.ts"                 # T004
# 兩者完成後再進行 POST 路由：
Task: "POST handler in app/api/orders/route.ts"            # T005
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup（T001）→ Phase 2 Foundational（T002，套用 migration）
2. Phase 3 US1（T003–T009）
3. **STOP & VALIDATE**：依 quickstart S1、S2、S4、S5、S7 驗證建立訂單
4. 可部署／展示 MVP（後台可新增訂單，來源預設「網站」）

### Incremental Delivery

1. Setup + Foundational → 基礎就緒
2. US1 → 獨立驗證 → 部署（MVP）
3. US2 → 獨立驗證（含 CSV、清單來源欄）→ 部署

---

## Notes

- [P] = 不同檔案、無相依
- 跨故事共用檔案（`app/lib/orders.ts`、`app/(admin)/orders/page.tsx`）須避免平行改動
- 金額一律由後端計算，前端送來的價格／小計不採信（安全＋原則 V）
- 完成每個任務或邏輯群組後即提交
- 可在任一 Checkpoint 停下獨立驗證
