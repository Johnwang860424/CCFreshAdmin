# Tasks: 新增訂單重複下單警示

**Input**: Design documents from `/specs/012-duplicate-order-warning/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/duplicate-order-check.md, quickstart.md

**Tests**: 未要求測試任務（專案無測試框架，憲法規定以 `npm run lint`、`npm run build` 與手動驗證取代）。

**Organization**: 本功能只有一個 user story（US1, P1），即完整 MVP。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、無未完成依賴）
- **[US1]**: 對應 spec.md User Story 1

## Path Conventions

Next.js App Router 單一專案，路徑皆自 repo root（`D:\project\CCFreshAdmin`）。

---

## Phase 1: Setup

**Purpose**: 分支準備；既有專案無其他初始化需求。

- [X] T001 自 `main` 開出並切換到分支 `feature/duplicate-order-warning`（目前工作分支為 `feature/duplicate-order-filter`，勿混入 011 的變更）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 無——零 schema 變更、零新端點、零共用基礎建設；全部工作屬 US1。

**Checkpoint**: 直接進入 US1。

---

## Phase 3: User Story 1 - 建立訂單前偵測同路線同名訂單並警示 (Priority: P1) 🎯 MVP

**Goal**: 後台新增訂單送出時，後端檢查目標路線分組（路線／宅配／未分路線）內是否已有同名（去頭尾空白後完全相符）訂單；有則回 409 由前端跳確認窗（文字逐字固定），管理員「仍要建立」帶 `confirmDuplicate: true` 重送、「取消」保留表單；無同名則直接建立、零額外步驟。

**Independent Test**: quickstart.md 情境 1–8——同路線同名觸發警示且未建單、確認後成立、取消後表單保留、跨分組不警示、宅配/未分路線各自成組、多筆同名僅警示一次、確認後庫存不足仍照舊 400。

### Implementation for User Story 1

- [X] T002 [US1] `app/lib/orders.ts`：新增唯讀函式 `countSameNameOrdersInGroup({ customerName, deliveryMethod, pickupSpotId }): Promise<number>`——pickup 路徑用 `WITH target AS (SELECT route_id FROM pickup_spots WHERE id = ${pickupSpotId})` CROSS JOIN，條件 `o.delivery_method='pickup' AND ps.route_id IS NOT DISTINCT FROM t.route_id AND o.customer_name = ${customerName}`（spot 不存在 → target 空 → 回 0）；delivery 路徑條件 `o.delivery_method='delivery' AND o.customer_name = ${customerName}`；`COUNT(*)::int`。SQL 全程 tagged template 參數化（憲法 II），確切 SQL 見 data-model.md
- [X] T003 [US1] `app/api/orders/route.ts`：POST handler 於 `validateCreateOrderBody` 通過後、`createOrder` 之前——讀取 `body.confirmDuplicate`（handler 層，比照 009 的 `confirmCodeChange`；`validation.ts` 不動）；`confirmDuplicate !== true` 時呼叫 `countSameNameOrdersInGroup(parsed.value)`，count > 0 → 提前 `return NextResponse.json({ requiresConfirmation: true, duplicateCount: count, error: "系統偵測到您可能已有訂單。請確認是否為重複下單" }, { status: 409 })`——此路徑不呼叫 `createOrder`、不呼叫 `revalidateCache("products")`；其餘流程（建立、革除快取、回 `{ success, id, pickupNumber, spotCode }`）不變（depends on T002；契約見 contracts/duplicate-order-check.md）
- [X] T004 [P] [US1] `app/(admin)/orders/page.tsx`：將 `handleCreate` 的送出與成功收尾抽成共用函式 `submitOrder(values, confirmDuplicate?: boolean)`——POST body 追加 `confirmDuplicate`（未帶時省略），成功收尾（`messageApi.success("訂單已新增")`、關閉新增 Modal、`form.resetFields()`、取貨號成功視窗、`fetchRouteOptions()`、`selected` 存在時 `fetchOrders(selected)`）維持單一實作供首送與確認重送共用；行為與現行完全一致（與 T003 不同檔、僅依契約，可平行）
- [X] T005 [US1] `app/(admin)/orders/page.tsx`：`handleCreate` 的 catch 分支——`e instanceof ApiError && (e.body as { requiresConfirmation?: boolean } | null)?.requiresConfirmation === true` 時改開 `modal.confirm`（用頁面既有 `App.useApp()` 的 `modal` 實例）：`content` 逐字「系統偵測到您可能已有訂單。請確認是否為重複下單」、`okText: "仍要建立"`、`cancelText: "取消"`；`onOk` → `submitOrder(values, true)`（錯誤仍以 `messageApi.error` 顯示）；取消 → 只關確認窗，新增訂單 Modal 與已填內容保留；非 `requiresConfirmation` 錯誤維持既有 `messageApi.error` 路徑（depends on T004，同檔不平行）
- [X] T006 [US1] 依 quickstart.md 逐項手動驗證情境 1–8 與 API 層抽查（409 body 欄位、`confirmDuplicate: true` 重送 200），全數通過後勾銷本任務

**Checkpoint**: US1 完成即功能完成，可獨立驗證與交付。

---

## Phase 4: Polish & Cross-Cutting Concerns

- [X] T007 執行 `npm run lint` 與 `npm run build`，兩者均須通過（TS strict；憲法 Development Workflow）
- [X] T008 [P] `CLAUDE.md`：於 orders 相關段落補一句本功能約定——後台新增訂單為兩段式重複確認（同分組同名 → `POST /api/orders` 回 409 `requiresConfirmation`，帶 `confirmDuplicate: true` 重送；比對僅姓名去頭尾空白、分組同 011 視圖語意），與 009 模式對齊

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 無依賴
- **Foundational (Phase 2)**: 空
- **US1 (Phase 3)**: T001 完成後開始
- **Polish (Phase 4)**: US1 全數完成後

### Task Dependencies（US1 內）

```text
T001 → T002 → T003 ─┐
        └→ T004 ────┴→ T005 → T006 → T007, T008
```

- T002（資料層查詢）先行；T003 依賴 T002。
- T004 與 T003 不同檔、僅依契約文件，可與 T003 平行。
- T005 依賴 T004（同檔 `orders/page.tsx`，且需要 `submitOrder` 存在）；端到端驗證（T006）需 T003＋T005 皆完成。

### Parallel Opportunities

- **T003 ∥ T004**：後端 409 分支與前端 `submitOrder` 抽取分屬 `app/api/orders/route.ts` 與 `app/(admin)/orders/page.tsx`，可同時進行。
- **T007 ∥ T008**：lint/build 與 CLAUDE.md 補記互不相干。
- 其餘任務因依賴或同檔（T004/T005）循序執行。

## Parallel Example: User Story 1

```bash
# T002 完成後可同時進行：
Task: "T003 app/api/orders/route.ts POST 加入 confirmDuplicate 檢查與 409 分支"
Task: "T004 app/(admin)/orders/page.tsx 抽出 submitOrder(values, confirmDuplicate?)"
```

---

## Implementation Strategy

### MVP First（US1 = 全功能）

1. T001 開分支。
2. T002 → T003（後端完成後即可用 curl/API 驗證 409 契約）。
3. T004 → T005（前端確認窗）。
4. T006 quickstart 手動驗證 → **STOP and VALIDATE**。
5. T007/T008 收尾後提交 PR。

本功能單一 story、無增量切分需求；共 8 個任務、3 個來源檔案異動（`app/lib/orders.ts`、`app/api/orders/route.ts`、`app/(admin)/orders/page.tsx`）＋ `CLAUDE.md` 補記。

## Notes

- 憲法 II：所有新 SQL 走 `sql` tagged template；憲法 III：無新端點，`jsonHandler` 包裝不變；憲法 V：檢查唯讀，訂單寫入路徑不動。
- 跳窗文字為 spec FR-003 逐字要求，實作時不得改寫（全形標點；2026-07-13 裁決：不含「⚠️」emoji，警示改用 confirm 視窗內建圖示）。
- TOCTOU 空窗為 spec 明載的接受項，不加鎖、不加唯一約束。
