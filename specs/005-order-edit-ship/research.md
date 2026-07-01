# Phase 0 Research: 訂單修改、刪除與出貨/CSV 分離

本功能無 spec 級 NEEDS CLARIFICATION（兩項已於 /speckit-specify 與使用者確認）。以下記載實作層級的關鍵設計決策。

## D1 — 明細定價快照規則（新增 vs. 既有）

- **Decision**：編輯儲存時，對「新增」明細以商品**目前**的 `price`/`promo_*` 建立快照並以 `calcLineSubtotal` 計算 `subtotal`；對「既有保留」明細維持其原始 `unit_price`/`promo_type`/`promo_config` 快照，僅在數量變動時以該原始快照重算 `subtotal`。
- **Rationale**：符合 FR-008／FR-009。既有明細代表消費者下單當下已成立的價格，不應因後台改價而變動；新增明細則反映當前售價。與 `createOrder` 一律用現價的行為一致（新增情境）。
- **Alternatives considered**：
  - 全部明細一律以商品現價重算 → 否決：會竄改既有明細的歷史金額，違反快照精神。
  - 全部凍結、新增也用「某個歷史價」→ 否決：新增品項無合理歷史價可循，且不符使用者對「追加即用現價」的預期。

## D2 — 編輯請求的表達方式（diff 而非全覆蓋原始值）

- **Decision**：`PUT /api/orders/[id]` 請求體傳「最終明細清單」，每列為
  `{ id?: number, productId?: number, quantity: number }`：
  - 帶 `id` → 既有 `order_items` 列（保留快照、套用新 quantity）。`id` 必須屬於此訂單。
  - 帶 `productId`（無 `id`）→ 新增列（用商品現價快照）。
  - 原訂單中未出現在清單裡的既有列 → 視為移除。
- **Rationale**：一次請求即可表達新增／保留改量／移除，前端 antd `Form.List` 天然對應。金額不由前端提供（沿用「金額後端算」原則）。
- **Alternatives considered**：分別 `POST item / PATCH item / DELETE item` 三支細粒度端點 → 否決：多次往返、非原子、與現有「整筆訂單一次寫入」風格不一致。

## D3 — 原子性（Neon HTTP 無互動式交易）

- **Decision**：以**單一 CTE 語句**原子替換該訂單明細並更新總額：`WITH del AS (DELETE FROM order_items WHERE order_id=$id), ins AS (INSERT ... SELECT ... FROM unnest($arrays)), upd AS (UPDATE orders SET total=$total WHERE id=$id RETURNING id) SELECT id FROM upd`。回傳 `upd` 空列 → 訂單不存在（並發刪除／出貨），回 404 友善訊息。
- **Rationale**：沿用 `createOrder` 既有的 CTE + `unnest(...)` 手法，單語句一致快照、無需 `transaction()` API，與現行程式風格一致。
- **Alternatives considered**：
  - `sql.transaction([...])`（Neon 批次交易）→ 可行但引入專案尚未使用的模式，且明細列數不定，仍需動態組裝；CTE 已足夠。
  - 先 DELETE 再 INSERT 分兩次呼叫 → 否決：非原子，中途失敗會留下空明細訂單。

## D4 — 出貨 / 匯出 CSV 的端點切分

- **Decision**：保留分組彙整 `GET /api/orders/close`。將原本「POST=匯出 CSV、DELETE=清除」重整為兩個**語意獨立**的動作：
  - **匯出 CSV**：沿用 `POST /api/orders/close`（回傳 CSV，不刪任何資料）。
  - **出貨（清除）**：沿用 `DELETE /api/orders/close`（呼叫既有 `deleteOrdersByGroup`，不再要求先下載 CSV）。
  前端不再把兩者串成一鍵；「出貨」按鈕只呼叫 DELETE（帶不可復原確認），「匯出 CSV」按鈕只呼叫 POST 下載。
- **Rationale**：後端既有端點語意本就分離（POST 純匯出、DELETE 純清除），符合 FR-015/FR-017 只需改前端串接與 UI 文案，改動面最小、風險最低。
- **Alternatives considered**：新增 `/api/orders/ship`、`/api/orders/export` 兩支新路由 → 否決：既有 `/close` 已提供完全對應的兩個 verb，新增路由徒增重複。（實作時若覺 `close` 命名語意過時，可保留路徑僅調整前端文案；重命名路由非必要。）

## D5 — 與憲章原則 V 的相容性（Order History Is Immutable）

- **Decision**：本功能就地編輯／刪除既有訂單列，與原則 V 現行字面衝突；判定為**使用者明示的刻意偏離**，並於實作 PR 連帶**修訂原則 V**（MINOR 版號），將其重新定義為：「**出貨（清帳）前的訂單為可修改工作資料；出貨為不可逆的清帳邊界，之後不再有該筆資料**」，同時保留「快照欄位於寫入時建立並在其生命週期內保存」「參照完整性 `ON DELETE RESTRICT/CASCADE`」等既有約束。
- **Rationale**：原則 V 的本意是保護「已完成之歷史財務紀錄」；本專案訂單於每檔出貨即被清除，出貨前實為開放中的工作訂單，允許編輯不牴觸其立法目的。使用者已明確要求此能力。
- **Alternatives considered**：
  - 硬性遵守原則 V、拒絕實作 → 否決：直接違背使用者需求。
  - 以「新增沖銷列／版本化」保留不可變性 → 否決：對此規模與清帳即清除的模型過度設計。

## D6 — 取貨號碼牌與並發

- **Decision**：編輯品項不動 `pickup_spot_id`，故不觸發取貨號碼牌重指派；刪除單筆訂單不回收號碼、不重編（允許跳號）。並發（他人已刪除／已出貨）情形，PUT 以 `upd` 空列、DELETE 以 rowCount=0 偵測並回友善「訂單不存在」訊息。
- **Rationale**：號碼牌唯一鍵為 `(pickup_spot_id, pickup_number)`；不改取貨點即無衝突。跳號在現行模型中本可接受（出貨清除後自然歸 1）。
- **Alternatives considered**：刪除後重編號碼 → 否決：破壞已印出的號碼牌對應，且無業務價值。
