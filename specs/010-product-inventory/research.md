# Research: 商品庫存管理與防止超賣

**Date**: 2026-07-12 | **Plan**: [plan.md](./plan.md)

Technical Context 無 NEEDS CLARIFICATION；本文件記錄關鍵技術決策與替代方案評估。

## R1: 庫存欄位設計

**Decision**: `products.stock INTEGER`（nullable）＋具名 CHECK `products_stock_nonneg CHECK (stock IS NULL OR stock >= 0)`。NULL＝不限量（不追蹤）。Migration `007_add_product_stock.sql`，既有商品不回填。

**Rationale**:
- Clarification 裁決庫存＝「剩餘可售計數器」單一數字，一欄即足；nullable 讓既有商品零遷移成本（預設不限量、行為不變）。
- **具名** constraint 是刻意的：SQLSTATE 23514 的錯誤分流靠 constraint 名判別（比照 009 對 23505 依 constraint 名分流的既有模式），避免誤攔其他 CHECK（`order_items` 的 quantity/subtotal CHECK 同為 23514）。
- 比照 `price INTEGER` 慣例（憲法 Technology Constraints）：API 驗證非負整數、data module 以 `number | null` 傳遞。

**Alternatives considered**:
- 獨立 `inventory` 表（product_id, stock, …）：為單一數字開新表無收益，且 JOIN 徒增所有讀路徑成本。拒絕。
- `NOT NULL DEFAULT 0`：會讓全部既有商品立即「售完」，違反 clarification（預設不限量）。拒絕。
- 檔期總量＋已訂量推算剩餘：clarification 已裁決採計數器模式。拒絕。

## R2: 原子防超賣機制（核心）

**Decision**: 庫存扣減放進訂單寫入的**同一條單一 CTE 語句**。`createOrder` 在既有 `WITH new_order … INSERT order_items` 語句中加一個 `dec` CTE：

```
dec AS (
  UPDATE products p
  SET stock = p.stock - t.qty
  FROM (每商品合計數量的 unnest) t
  WHERE p.id = t.product_id AND p.stock IS NOT NULL
)
```

任一商品扣到負值 → CHECK `products_stock_nonneg` 違反（23514）→ **整句失敗**：訂單、明細、所有扣減零部分效果（FR-005、FR-006）。

**Rationale**:
- Neon serverless HTTP driver 無互動式交易——單語句原子是本 repo 的既定模式（憲法原則 V；`createOrder`/`updateOrderItems`/`saveProductImages` 皆如此）。
- 併發正確性由 Postgres 行鎖保證：兩筆併發訂單對同一商品的 UPDATE 序列化，後者在前者 commit 後重讀已扣後的值再套用 CHECK——不需 SELECT FOR UPDATE、advisory lock 或 serializable isolation。`WHERE stock IS NOT NULL` 讓不限量商品完全跳過（不加鎖、不扣減，FR-009）。
- DB 層防線同時是「未來擴充」的保險：任何之後新增的寫入路徑（例如顧客端 App 若日後要防超賣）都撞同一 CHECK。

**Alternatives considered**:
- 條件式 UPDATE（`WHERE stock >= qty`）＋檢查 affected rows：在單一 CTE 語句內無法「發現少扣就中止 INSERT」，需拆多語句 → 失去原子性。拒絕。
- 先檢查後寫入（兩語句）：檢查與寫入間有競態窗口，正是超賣成因。拒絕（僅保留為友善訊息用的預檢，見 R3）。
- DB trigger 自動扣減：把業務規則藏進 DB，違反本 repo「SQL 集中在 data module」的慣例，且對 App 訂單行為造成非預期改變（違反 FR-010）。拒絕。

## R3: 友善錯誤訊息（雙層檢查）

**Decision**: 寫入前先預檢（`SELECT id, name, stock FROM products WHERE id = ANY(…)` 已是 createOrder 既有查詢，直接多帶 stock），不足時擲 `OrderInputError`，訊息格式「「商品名」庫存不足（剩餘 N）」（多品項不足時併列）。競態漏網（預檢過但寫入時被搶）由 catch 23514＋constraint 名 `products_stock_nonneg` 分流 → 重查該單商品目前庫存、組同款訊息。HTTP 400，沿用訂單頁既有的 error 顯示通道。

**Rationale**: CHECK 違反的原生錯誤無法直接變成含商品名與剩餘量的 zh-TW 訊息（SC-003 要求 100% 顯示），預檢負責訊息品質、CHECK 負責正確性；兩層各司其職。`updateOrderItems` 同樣：僅對正 delta 預檢。

**Alternatives considered**:
- 只靠 23514 再重查：可行但每次不足都多一輪失敗寫入；預檢讓常見案例（非競態）一次讀取就給出完整明細。採兩層。
- 結構化錯誤 payload（product id 清單）：訂單頁現行以 message 字串顯示錯誤，字串已滿足 SC-003；不引入新 UI 通道。拒絕。

## R4: 編輯訂單的淨差額扣補

**Decision**: `updateOrderItems` 在 TS 端計算每商品 `delta = 新合計數量 − 舊合計數量`（舊值來自既有明細快照查詢——需補選 `quantity` 欄；`product_id IS NULL` 的已刪商品列自然略過），以平行陣列傳入既有 del/ins/total 的同一 CTE 語句，加一個 `UPDATE products SET stock = stock - delta WHERE id = ANY(…) AND stock IS NOT NULL`（delta 正＝扣、負＝補，一個 UPDATE 兩用）。

**Rationale**: FR-007「僅就淨增加量檢查」——把甲從 3 件改 4 件只需再扣 1 件，即使目前剩餘量小於 4；負 delta 回補與正 delta 扣減在同句內完成，訂單與庫存永不分歧（憲法原則 V 的原子性延伸）。

**Alternatives considered**:
- 全補回舊量再全扣新量（兩個 UPDATE）：中間狀態可能讓 CHECK 誤放（先補後扣在同語句內其實不可見中間態，但兩個 UPDATE 對同列衝突且邏輯繞）。單一 delta UPDATE 更簡單正確。拒絕。

## R5: 刪單回補 vs 出貨不回補

**Decision**: `deleteOrder`（單筆刪除）改為單一 CTE：`DELETE FROM orders … RETURNING id` ＋ 讀 `order_items` 合計（同語句 snapshot，CASCADE 尚未影響讀值）→ `UPDATE products SET stock = stock + q`。`deleteOrdersByIds`（選取出貨）與 `deleteOrdersByGroup`（結單出貨）**零改動**（不回補，clarification 裁決）。

**Rationale**: PostgreSQL 的 WITH 子句各部分讀同一 snapshot——sibling CTE 讀 `order_items` 看得到被 CASCADE 刪除前的列，回補量正確（SC-004）。出貨＝實際售出，是結算邊界（憲法原則 V）。

**Alternatives considered**:
- 先讀明細再刪（兩語句）：讀與刪之間訂單可能被併發修改 → 回補錯量。拒絕。

## R6: 快取一致性

**Decision**: `getProducts` 被 `unstable_cache(tags: ["products"])` 包住，而庫存現在會隨訂單異動——orders 的 POST／PUT／DELETE 於庫存異動成功後呼叫 `revalidateCache("products")`（既有 helper）。

**Rationale**: 商品列表的剩餘量（US1）與訂單商品選單的售完 disabled（FR-011）都吃 `/api/products`；不 revalidate 會顯示過期庫存。預檢與扣減本身讀 DB 即時值，正確性不依賴快取——revalidate 只影響顯示鮮度。

**Alternatives considered**:
- stock 改走獨立未快取查詢：拆散 ProductRow、兩端點兩次請求；revalidate 一行解決同樣問題。拒絕。

## R7: 顧客端 App 相容性

**Decision**: 欄位 additive、App 寫入路徑零改動；App 建立的訂單**不扣庫存**（clarification：App 端防線不在本次範圍）。後台對 App 訂單的編輯/刪除仍套統一的淨差額扣/補規則（FR-007 不分訂單來源）。

**Known consequence（記錄供未來 App 端功能參考）**: App 訂單成立時未扣過庫存，後台若刪除該訂單或調降其數量會回補「未曾扣過」的量——管理員以「剩餘可售」心智模型手動維護計數即可校正；規則統一比依來源分流簡單可預期（spec Assumptions 已載明）。

## R8: UI 呈現

**Decision**:
- 商品表單：`InputNumber`（min 0、precision 0、留空＝不限量），驗證比照 price 的整數 pattern；商品列表新增「庫存」欄——數字／灰字「不限量」／紅色「售完」Tag（stock=0）。
- 訂單新增/編輯的商品 `Select`：`stock === 0` 的選項 `disabled` ＋「售完」標示；有追蹤庫存者於選項顯示「剩餘 N」輔助；數量欄不設前端上限（伺服器為最終防線，避免前端快取值造成假上限）。

**Rationale**: FR-002、FR-011 與 clarification（售完標示且不可選）；antd v6 `Select` options 原生支援 `disabled`。
