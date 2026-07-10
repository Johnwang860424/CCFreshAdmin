# Research — 取貨號碼英數格式（008-pickup-code-format）

Phase 0 產出。規格無遺留 NEEDS CLARIFICATION；以下為技術決策與現況查證。

## 現況查證（程式碼實讀）

- `orders.pickup_number`：`INTEGER NOT NULL`，唯一鍵 `UNIQUE NULLS NOT DISTINCT (pickup_spot_id, pickup_number)`（`db/schema.sql` + `db/migrations/fix_delivery_unique_number.sql`）。
- 指派邏輯（`app/lib/orders.ts` `createOrder`）：自取以該站 `MAX+1`、**宅配亦有自己的序列**（`pickup_spot_id IS NULL` 作用域），撞 23505 重試（上限 5 次）。此邏輯**本功能完全不動**。
- 顯示點僅三處：訂單管理頁欄位（`app/(admin)/orders/page.tsx` columns）、同頁搜尋過濾（`String(order.pickupNumber).includes(search)`）、xlsx 匯出（`app/lib/order-export.ts` `orderToRow`，由 `orders/close` 與 `orders/selection` 共用）。訂單彙總頁（order-summary）只列商品數量，不含取貨號，無需改動。
- API 回傳的 `OrderRow` 已含 `pickupSpotId` 與 `pickupNumber` 兩欄，顯示層可直接組合，**零 API 變更**。
- `orders.pickup_spot_id` 為 `ON DELETE RESTRICT`：仍被訂單引用的站點不可刪，故自取訂單的 `pickupSpotId` 永遠有效，字母換算不會落空。

## D1 — 站點代碼換算規則

- **Decision**: 以 `pickup_spot_id` 做 Excel 式雙射 26 進位換算：1→A、2→B、…、26→Z、27→AA、28→AB…；大寫輸出。
- **Rationale**: `id` 是 serial、不可變、唯一 → 代碼永久穩定且互不相同（FR-001/003）；規則封閉、無狀態、可同構於 client 與 server。使用者已確認採 id 換算（零儲存）。
- **Alternatives considered**:
  - `pickup_spots` 新增 code 欄（可自訂、連號）— 使用者明確不要（不想存 DB）；需 migration + 管理 UI。
  - 依站點排序（sort_order）換算 — 零儲存但排序可變，站點增刪/重排會讓既有未出貨訂單號碼漂移，**不可接受**。
  - 以 city/township 字首當代碼 — 中文無自然英文字首，需轉譯表 = 變相儲存。

## D2 — 衍生位置：顯示層純函式，零後端變更

- **Decision**: 新增 `app/lib/pickup-code.ts` 純函式模組（`spotCodeFromId(id)`、`formatPickupCode(spotId, pickupNumber)`），由訂單頁與 `order-export.ts` 引用；SQL、API route、`orders.ts` 寫入邏輯全部不動。
- **Rationale**: payload 已含所需兩欄；集中一個模組保證清單/匯出/搜尋三處一致（SC-002）；外部顧客端 App 寫入路徑零影響（FR-008、SC-003）；上線即對既有訂單生效（FR-009），無遷移。
- **Alternatives considered**:
  - 在 SQL SELECT 組字串 — 需改五處查詢、client 搜尋仍要本地邏輯、DB 端 26 進位換算繁瑣；否決。
  - 改存 TEXT 型 pickup_number（"A1"）— 動 schema 且外部 App 寫整數會壞；違反使用者決策；否決。

## D3 — 宅配訂單處理

- **Decision**: 宅配維持現狀：顯示自身序列的純數字（無站點代碼）；`formatPickupCode` 在 `spotId === null` 時回傳純數字字串。
- **Rationale**: 現行程式已為宅配指派並顯示號碼（NULL-spot 序列）；「各站點不能重複」的需求範圍是自取站點；站點號碼一律以英文開頭，與宅配純數字天然可區分。（注意：規格 002 時代文件寫宅配顯示「-」，經查證已非現況，spec 已更正。）
- **Alternatives considered**:
  - 宅配加保留字首（如 D、Z）— 與 id 換算出的站點字母（第 4 站即 D）必然衝突空間；否決。
  - 宅配顯示「-」 — 對照現況是功能退化；否決。

## D4 — 搜尋比對

- **Decision**: 訂單頁搜尋以「格式化後號碼」做不分大小寫的 substring 比對（輸入 `a1`／`A1` 皆命中 A1）；其餘欄位（客戶/電話/地址/id）比對邏輯不變；搜尋 placeholder 文案不需改。
- **Rationale**: FR-006 要求新格式可搜尋；使用者手機輸入常為小寫。
- **Alternatives considered**: 僅精確等值比對 — 現行其他欄位皆 substring，行為不一致；否決。

## D5 — 既有未出貨訂單與上線

- **Decision**: 無資料遷移、無 schema 變更；部署即生效，既有訂單以「所屬站點代碼＋既有流水號」呈現。
- **Rationale**: 號碼是衍生呈現（FR-009）；`db/schema.sql` 無需更動（憲法的 schema 變更條款不觸發）。
- **Alternatives considered**: 回填/改寫既有號碼 — 無欄位可回填（本來就不存字串），不適用。
