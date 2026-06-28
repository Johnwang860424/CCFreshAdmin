# Phase 0 Research: 商品排序功能

## Decision 1 — 順序儲存模型：整數 `sort_order` 欄位

- **Decision**: `products` 加 `sort_order INTEGER NOT NULL`；列表 `ORDER BY sort_order, id`。
- **Rationale**: 整數位置最直觀、查詢可加 index；既有資料層皆 raw SQL，新增欄位成本低。
- **Alternatives considered**:
  - Linked-list（prev/next 指標）：插入 O(1) 但查詢需遞迴，過度設計。
  - 浮點/分數排序鍵（避免整次重排）：對數十～數百筆規模無必要，且浮點精度耗盡需重整。

## Decision 2 — 既有資料 migration（使用者明確要求考慮舊資料）

- **Decision**: 三步驟一次性 migration：
  1. `ALTER TABLE products ADD COLUMN sort_order INTEGER;`
  2. `UPDATE products SET sort_order = id;`（以既有建立序回填）
  3. `ALTER TABLE products ALTER COLUMN sort_order SET NOT NULL;` + 建 index。
- **Rationale**: 以 `id` 回填可得確定、唯一、與現況一致的初始順序（現況即 `ORDER BY id`），上線視覺零變動。
- **Alternatives considered**:
  - 預設 0 後人工排：所有商品同序、列表不穩定，違反 FR-004。
  - 隨機/名稱排序：改變既有呈現，徒增困惑。

## Decision 3 — 原子重排（Neon HTTP 無互動式交易）

- **Decision**: `reorderProducts(ids)` 以**單一 SQL 語句**用陣列重寫順序：
  ```sql
  UPDATE products AS p
  SET sort_order = v.ord
  FROM (
    SELECT id, ord
    FROM unnest(${ids}::int[]) WITH ORDINALITY AS t(id, ord)
  ) AS v
  WHERE p.id = v.id
  ```
- **Rationale**: 單語句即原子（FR-007），免互動式交易；`${ids}` 經標籤模板自動參數化，符合專案安全慣例。`unnest ... WITH ORDINALITY` 直接把陣列索引變成新順序值。對拖拉當下已被刪除的 id，`WHERE` 自然略過（Edge Case）。
- **Alternatives considered**:
  - 逐筆 `UPDATE`：非原子、N 次往返、半套風險。
  - `neon().transaction([...])`：可批次但仍多語句；單語句更簡。

## Decision 4 — 拖拉 UI 方案：dnd-kit + antd Table

- **Decision**: 新增 `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`；以 `DndContext` + `SortableContext` 包住 antd `Table`，自訂可拖拉的 `row` component（拖拉把手）。
- **Rationale**: antd v6 官方範例（Drag sorting）即採 dnd-kit；`react-sortable-hoc` 已棄用。React 19 相容。
- **Alternatives considered**:
  - `react-dnd`：較重、API 較舊。
  - 上/下移按鈕：可達同效果但 UX 差，且使用者明確要求拖拉。

## Decision 5 — 排序模式下的分頁與搜尋

- **Decision**: 進入排序時顯示完整清單、停用搜尋過濾與分頁，避免跨頁/過濾後拖拉造成順序歧義；儲存後恢復。
- **Rationale**: 全域順序需對完整清單操作才正確；過濾後的局部拖拉語意不明。
- **Alternatives considered**: 僅當前頁可拖 → 跨頁無法調整，違反 Edge Case「跨分頁」需求。

## Decision 6 — 新商品位置

- **Decision**: `addProduct` 的 INSERT 以 `sort_order = (SELECT COALESCE(MAX(sort_order),0)+1 FROM products)` 排尾。
- **Rationale**: 滿足 FR-003，行為可預期。
- **Alternatives considered**: 排首（0/減一）→ 與既有插入直覺相反。
