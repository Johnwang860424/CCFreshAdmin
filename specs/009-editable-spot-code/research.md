# Research: 站點代碼改為可維護欄位（取貨號碼前綴）

> rev. 2026-07-11：回填規則改為「同路線內依 id 順序 A、B、C…、每路線自 A 起算」（使用者裁決），唯一性範圍隨之由全站改為同路線內。R1、R2、R5 已更新，新增 R8。

## R1. 欄位設計與唯一性

- **Decision**: `pickup_spots.code TEXT NOT NULL`，`CHECK (code ~ '^[A-Z]{1,3}$')`，`UNIQUE NULLS NOT DISTINCT (route_id, code)`。API 層先 trim + `toUpperCase()` 再入庫。
- **Rationale**: 唯一性作用域＝路線（使用者裁決：每路線都可有 A 站）。`route_id` 可為 NULL（未分路線），預設 UNIQUE 會視 NULL 各自相異、未分路線群組將失去保護，故用 `NULLS NOT DISTINCT`（PG15+；`orders` 的 `(pickup_spot_id, pickup_number)` 唯一鍵已用同語法，Neon 支援）。一律大寫儲存後，唯一性天然不分大小寫；CHECK 讓 DB 成為格式最後防線（資料層+DB 雙防線慣例）。1–3 字母涵蓋單路線超過 26 站的進位。
- **Alternatives considered**: `UNIQUE (code)` 全站唯一（與「每路線從 A 重編」直接矛盾，捨棄）；兩條 partial unique index（`WHERE route_id IS NOT NULL` + `WHERE route_id IS NULL`，較囉嗦且 constraint 名分流要處理兩個名字）；`citext`（需 extension）。

## R2. 既有站點回填（依路線重編）

- **Decision**: migration `006` 內以純 SQL 回填：同 `route_id`（NULL 自成一組）內依 `id` 順序取 `row_number()`，再轉 Excel 式字母：

  ```sql
  WITH numbered AS (
    SELECT id,
           row_number() OVER (PARTITION BY route_id ORDER BY id) AS rn
    FROM pickup_spots
  )
  UPDATE pickup_spots ps
  SET code = CASE
    WHEN n.rn <= 26  THEN chr(64 + n.rn::int)
    WHEN n.rn <= 702 THEN chr(64 + ((n.rn::int - 27) / 26) + 1)
                       || chr(65 + (n.rn::int - 1) % 26)
    ELSE chr(64 + ((n.rn::int - 703) / 676) + 1)
       || chr(65 + ((n.rn::int - 27) / 26) % 26)
       || chr(65 + (n.rn::int - 1) % 26)
  END
  FROM numbered n
  WHERE ps.id = n.id;
  ```

  之後才加 `NOT NULL` / `CHECK` / `UNIQUE`（先 `ADD COLUMN` nullable → 回填 → 上約束）。
- **Rationale**: 「同路線字母相鄰、每路線從 A 起算」符合現場按路線作業的心智模型（使用者需求）；`PARTITION BY route_id` 中 NULL 自成一個分割區，未分路線天然自成一組。由 `row_number()` 回填，路線內必不重複，唯一鍵必定建立成功。**代價：既有訂單前綴改變**（例如原全站換算的 C5 變 A5）——使用者已知悉並接受，上線後以新號碼為準。
- **Alternatives considered**: 沿用舊 id 換算回填（保留零感，但與使用者要求的每路線 A、B、C 直接矛盾）；全站連續編（跨路線不重碼，使用者未採）；Node 腳本回填（多一個執行環境，與手動 SQL 流程不符）。

## R3. 顯示來源切換

- **Decision**: `OrderRow` 新增 `spotCode: string | null`（`LEFT JOIN pickup_spots` 帶 `ps.code`，宅配為 null）；`formatPickupCode(spotCode, pickupNumber)` 改吃字串；`spotCodeFromId` 刪除。受影響查詢：`getOrders`、`getOrdersByIds`、`getOrdersByRoute`、`getDeliveryOrders`、`getOrderById`（皆已 JOIN `pickup_spots`，僅多帶一欄）。
- **Rationale**: 訂單頁、選取匯出、結單匯出全部經由 `OrderRow` → 單點供源保證三處一致（SC-001）；即時 JOIN 與現行「路線即時衍生」一致（spec 假設：代碼不快照）。
- **Alternatives considered**: 訂單快照代碼（違反 spec 假設，且改碼後新舊單前綴不一致更亂）；保留 `spotCodeFromId` 當 fallback（兩套來源，違反 FR-004「完全取代」）。

## R4. 有訂單站點改碼的警告機制

- **Decision**: 兩段式 PUT。`PUT /api/pickup-spots/[id]` 帶 `code`：若代碼有變、該站點尚有訂單、且未帶 `confirmCodeChange: true` → 回 `409 { requiresConfirmation: true, orderCount, error: ... }`；前端據此開 `Modal.confirm`（說明既有取貨號將即時改變），確認後帶 `confirmCodeChange: true` 重送。
- **Rationale**: 訂單數只有伺服器知道最準（`getPickupSpots` 走 `unstable_cache`，顧客端 App 隨時寫入訂單，快取的 hasOrders 會失準）；擋在伺服器也守住「未確認不得改碼」的規格語意（FR-007）。沿用既有 409 + error message 的回應慣例。
- **Alternatives considered**: 前端永遠警告（不分有無訂單，UX 噪音且不符 FR-007 條件式警告）；`getPickupSpots` 附 hasOrders（快取失準）；新增 orders-count 端點（多一端點、兩次往返，且 check-then-act 間隙依然存在，不如 PUT 內原子判斷）。

## R5. 23505 錯誤分流

- **Decision**: `pickup-spots.ts` 的 unique-violation 處理改依 `err.constraint` 名稱分流：`pickup_spots_city_township_key` → 既有 `PickupSpotDuplicateError`（同縣市已有相同地點）；`(route_id, code)` 唯一鍵（migration 中顯式命名 `pickup_spots_route_id_code_key`）→ 新 `SpotCodeDuplicateError`（「同路線已有相同代碼的站點」）。API 皆回 409。
- **Rationale**: 同一張表兩個 UNIQUE，僅靠 SQLSTATE 無法區分，訊息必須各自明確（FR-002 要求「明確錯誤」）。Neon serverless driver 的錯誤物件帶 `constraint` 欄位。migration 顯式 `CONSTRAINT ... UNIQUE NULLS NOT DISTINCT (...)` 命名，避免依賴自動命名規則。
- **Alternatives considered**: 先 SELECT 查重再寫入（TOCTOU 間隙，仍須處理 23505，等於做兩次）；統一訊息「資料重複」（無法指引管理員修正哪個欄位）。

## R6. 新增站點的代碼取得

- **Decision**: 新增表單必填、由管理員自行輸入（輸入時自動轉大寫）；不做自動建議。
- **Rationale**: 代碼已是人工維護的業務屬性（本功能核心），自動建議需再定義「下一個可用代碼」規則，超出 spec 範圍；站點新增頻率低。
- **Alternatives considered**: 「該路線最大代碼+1」預設值（規則模糊：跳過已刪站點的洞與否；可日後再加）；沿用 id 換算當預設（id 於 INSERT 前未知）。

## R7. 顧客端 App 相容

- **Decision**: 不動 `orders` 寫入路徑與 `pickup_number` 指派約定；`pickup_spots` 僅加欄位（additive）。
- **Rationale**: 顧客端 App 讀 `pickup_spots` 選點、寫 `orders`——加欄位不影響既有 SELECT/INSERT；FR-010 達成。
- **Alternatives considered**: 無（任何非 additive 變更都直接違反 FR-010）。

## R8. 改分路線撞碼（FR-008）

- **Decision**: 不寫前置查重——路線管理頁的 `updatePickupSpot(id, township, routeId)` 改動 `route_id` 時，若與目標路線既有代碼相撞，由 `UNIQUE NULLS NOT DISTINCT (route_id, code)` 直接以 23505 擋下，經 R5 分流回 409「同路線已有相同代碼的站點，請先修改其中一站的代碼」。路線管理頁沿用既有 409 錯誤顯示，前端零改動。
- **Rationale**: 唯一鍵天然覆蓋「改分路線」這條寫入路徑（constraint 是欄位組合層級，不分哪個欄位變動）；訊息足以指引管理員先去改碼。避免前置 SELECT 的 TOCTOU。
- **Alternatives considered**: 路線頁加改碼功能（超出 spec：代碼僅於自取點管理頁維護）；移動時自動改碼為目標路線下一個可用字母（隱性改號，違反 FR-007 的警告精神）。
