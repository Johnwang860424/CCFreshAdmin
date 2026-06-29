# Phase 0 Research: 後台新增訂單與來源標籤

本功能無 NEEDS CLARIFICATION 標記；以下記錄關鍵技術決策。

## R1. 來源標籤的資料表示與預設值

- **Decision**: `orders` 新增 `tag TEXT NOT NULL DEFAULT '網站'`。允許值由應用層限定為 `網站 / FB / Line`（不加 DB CHECK 約束，與既有 `delivery_method` 等以應用層驗證為主的風格一致）。
- **Rationale**: 使用者明確要求新增欄位且預設 `網站`。`NOT NULL DEFAULT '網站'` 使顧客端外部 App 即使不寫此欄位也自動得到正確來源，無需改動外部 App（符合「orders 由外部寫入」的現況）。既有列以一次性 `UPDATE ... SET tag = '網站' WHERE tag IS NULL`（若以可空方式新增）或直接靠 DEFAULT 回填。
- **Alternatives considered**:
  - 可空欄位、UI 顯示空白：被否決，使用者要求預設 `網站`。
  - DB CHECK 限定三值：可行但與專案「應用層驗證」慣例不符，且未來擴充來源需改 schema；暫不採用。

## R2. 新增訂單的原子寫入（訂單主檔 + 多筆明細）

- **Decision**: 在 `app/lib/orders.ts` 新增 `createOrder()`，以**單一 CTE SQL 語句**完成：`WITH new_order AS (INSERT INTO orders (...) VALUES (...) RETURNING id) INSERT INTO order_items (order_id, ...) SELECT new_order.id, * FROM new_order, unnest($items...) ...`。
- **Rationale**: Neon serverless **HTTP driver 無互動式交易**，但單一 SQL 語句本身即為原子。此模式已有先例（`reorderProducts` 以單句 `unnest ... WITH ORDINALITY` 達原子重寫）。符合 FR-012 原子性與原則 II 參數化。
- **Alternatives considered**:
  - `sql.transaction([...])` 批次：可原子送出，但陣列內語句在送出前即建構，後句無法取用前句 `RETURNING` 的 `order_id`，不適合此「先建主檔再插明細」情境。
  - 兩次獨立 `sql` 呼叫：非原子，明細插入失敗會留下無明細的孤兒訂單，違反 FR-012。

## R3. 明細小計與總額計算（快照）

- **Decision**: 後端於 `createOrder` 前，依送入的 `productId + quantity`，自 `products` 即時查出每項的 `name / price / promo_type / promo_config`，以共用的 `calcLineSubtotal()`（`app/lib/promotions.ts`）算出 `subtotal`，加總為 `total`，並將 `product_name / unit_price / quantity / promo_type / promo_config / subtotal` 一併快照寫入 `order_items`。
- **Rationale**: 與顧客端下單一致、符合原則 V「明細快照」。計算放伺服器端，避免信任前端傳來的價格／小計（安全）。`calcLineSubtotal` 為前後端共用純函式，前端可同步預覽總額、後端為權威來源。
- **Alternatives considered**: 信任前端送來的 `unitPrice/subtotal/total`：被否決，價格不可由用戶端決定。

## R4. 自取訂單的取貨號碼牌指派

- **Decision**: 自取訂單 `pickup_number = (SELECT COALESCE(MAX(pickup_number),0)+1 FROM orders WHERE pickup_spot_id = $spot)`，撞 `UNIQUE (pickup_spot_id, pickup_number)` 時於應用層重試（有限次數）。宅配訂單 `pickup_number = NULL`。
- **Rationale**: 沿用 `db/schema.sql` 既載明的寫入端約定，與外部 App 行為一致，確保同一取貨點號碼不重複（SC-004）。
- **Alternatives considered**: DB 序列／觸發器：超出本功能範圍且改動面大；維持既有約定即可。

## R5. API 授權（Deny-by-default）

- **Decision**: 新 `POST /api/orders` handler **內部顯式呼叫 `auth()`**，未通過則回 401，再進行驗證與寫入。
- **Rationale**: `proxy.ts` 的 matcher 除 `api/auth` 外皆已涵蓋 `/api/*`，故 API route 亦受 middleware 保護；但為落實縱深防禦（Defense-in-depth），原則 III 要求變更資料的 handler 仍應顯式驗證授權。新增訂單為寫入操作，必須守門。
- **Note / Alternatives**: 既有變更型 route（如 `products` POST、`orders/close`）目前**未**顯式 `auth()`，屬既有偏離，不在本功能範圍內修正；本功能採合規作法，並可於 PR 註記建議後續補強既有路由。

## R6. 前端表單（新增訂單 Modal）

- **Decision**: 在 `orders/page.tsx`（已 `"use client"`）以 antd `Modal + Form` 實作。欄位：客戶姓名（必填）、電話（選填）、來源（Select：網站/FB/Line，預設網站）、取貨方式（自取／宅配切換）、自取點（Select，取自既有 pickup-spots API）、宅配地址（宅配時必填）、商品明細（`Form.List`：商品 Select ＋ 數量 InputNumber，至少一項）、備註。送出前以 `calcLineSubtotal` 即時顯示預估總額。
- **Rationale**: 沿用既有頁面與 antd v6 慣例；商品與取貨點清單複用既有 `GET /api/products`、`GET /api/pickup-spots`。
- **Alternatives considered**: 獨立頁面而非 Modal：與既有「結單 Modal」風格不一致，且新增訂單為輕量表單，Modal 即足夠。

## R7. 來源標籤於清單與 CSV 匯出

- **Decision**: `OrderRow` 增加 `tag` 欄；訂單清單表格新增「來源」欄（antd `Tag` 呈現）；結單 CSV（`orders/close/route.ts`）header 與每列加入「來源」欄位。
- **Rationale**: 滿足 FR-007 / FR-013，使來源資訊在檢視與匯出皆可見。
- **Alternatives considered**: 僅清單顯示、不入 CSV：被否決，FR-013 要求匯出含來源。
