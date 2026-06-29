# Phase 0 Research: 自取點編輯與排序

沿用 `001-product-sorting` 的既有決策；以下記錄本功能特有（縣市分群）的決策差異。

## Decision 1：排序鍵的作用域 — 每縣市（per-city），非全域

- **Decision**: `pickup_spots` 新增單一 `sort_order INTEGER NOT NULL` 欄，但其語意為「**同縣市內**的相對順序」。列表排序為 `ORDER BY city, sort_order, id`；縣市之間的順序不靠此欄，而由前端依 `TAIWAN_LOCATIONS` 索引決定群組先後。
- **Rationale**: spec 要求拖拉僅限同縣市群組內、縣市間維持固定序。把 `sort_order` 限定在縣市內，重排只需重寫「該縣市」的列，互不干擾；新增取「該縣市」的 MAX+1。單欄即可，無需複合排序欄或額外 group 表。
- **Alternatives considered**:
  - 全域單一 `sort_order`（同商品）：無法表達「縣市間固定序、僅群組內可動」，且跨縣市重排會牽動不相干列。否決。
  - 另建 `pickup_spot_order` 關聯表：過度設計，低併發單頁不需要。否決。

## Decision 2：縣市群組的固定順序來源

- **Decision**: 縣市群組先後沿用 `app/lib/taiwan-locations.ts` 的 `TAIWAN_LOCATIONS` 順序（即新增表單縣市下拉的排列，台灣行政區既定順序）。前端分組後，以 `TAIWAN_LOCATIONS.indexOf(city)` 排序群組；不在清單中的縣市（理論上不會發生）排在最後、以名稱 fallback。
- **Rationale**: 此順序已是專案唯一的縣市權威清單，與使用者新增時所見一致；零額外資料、零 migration。spec 假設亦採此。
- **Alternatives considered**: 純字母/Unicode 排序（Postgres `ORDER BY city` 現況）——與行政區直覺不符，且使用者在 spec 標示未定、預設選行政區序。保留為可調整點。

## Decision 3：每縣市重排的原子寫入

- **Decision**: 沿用商品 reorder 的單語句 `unnest(${ids}::int[]) WITH ORDINALITY`，但加 `AND p.city = ${city}` 限制只改該縣市的列：
  ```sql
  UPDATE pickup_spots AS p
  SET sort_order = v.ord
  FROM (SELECT id, ord FROM unnest(${ids}::int[]) WITH ORDINALITY AS t(id, ord)) AS v
  WHERE p.id = v.id AND p.city = ${city};
  ```
- **Rationale**: Neon serverless HTTP 無互動式交易；單一語句即達原子性（FR-014）。加 `city` 條件確保即使前端誤傳他縣市 id 也不會被改動，符合「禁止跨縣市」（FR-007）。陣列中已不存在 / 非該縣市的 id 自然被 WHERE 略過。
- **Alternatives considered**: 逐列 UPDATE（多次往返、非原子）否決；多語句交易（驅動不支援）否決。

## Decision 4：編輯 township 的唯一性衝突處理

- **Decision**: 編輯只更新 `township`（`city` 唯讀，不出現在 UPDATE）。倚賴既有 `UNIQUE (city, township)` 約束；資料層捕捉 Postgres unique violation（SQLSTATE `23505`）後拋出 `PickupSpotDuplicateError`，route 回 `409`，前端提示「同縣市已有相同地點」。
- **Rationale**: DB 約束是唯一性的權威來源，避免「先查再寫」競態。鏡射既有 `PickupSpotInUseError → 409` 的錯誤型別模式（`app/lib/pickup-spots.ts` 已有先例）。
- **Alternatives considered**: 應用層先 `SELECT` 檢查重複——有 TOCTOU 競態且多一次往返。否決（仍可作為前端即時提示的輔助，但 DB 為最終把關）。

## Decision 5：排序鍵不加 DB UNIQUE 約束

- **Decision**: `(city, sort_order)` 不加 DB UNIQUE，唯一性由應用層保證（migration 回填唯一、reorder 重寫唯一、新增取該縣市 MAX+1）。建立 `INDEX idx_pickup_spots_city_sort ON pickup_spots(city, sort_order)` 純為排序效能。
- **Rationale**: 與商品排序一致；容忍重排瞬時狀態、簡化單語句更新；低併發後寫覆蓋即可。
- **Alternatives considered**: `UNIQUE (city, sort_order)`——重排當下可能短暫衝突、使單語句更新複雜化。否決。

## Decision 6：排序模式的分群拖拉 UI

- **Decision**: 排序模式下，依縣市把資料切成多個群組；每個縣市群組各自一個 `DndContext` + `SortableContext`（`verticalListSortingStrategy` + `restrictToVerticalAxis`/`restrictToParentElement`），確保拖拉天然受限於該縣市區塊內。每群組以縣市標題分隔，列左側顯示 `DragHandle`（鏡射商品頁 `RowContext`/`SortableRow`/`DragHandle`）。一般模式維持單一 antd `Table`（搜尋、分頁、操作欄）。
- **Rationale**: 多個獨立 `DndContext` 是「禁止跨群組拖拉」最簡單、最穩健的作法——拖拉事件不會跨 context；無需在 `onDragEnd` 寫複雜的同縣市檢查。`restrictToParentElement` 進一步把視覺位移限制在該群組容器內。
- **Alternatives considered**: 單一 `DndContext` 涵蓋全部、在 `onDragEnd` 比對 `active`/`over` 的 city——可行但需額外防呆且使用者體驗（可拖到別群組再被彈回）較差。否決。
