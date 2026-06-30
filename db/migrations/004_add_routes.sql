-- 一次性 migration：新增送貨路線（routes）並讓取貨點歸屬路線（後台分組用）。
-- 於 Neon SQL Editor 執行。既有 pickup_spots 列 route_id 維持 NULL（自動落入「未分路線」）。
-- 取貨點排序（sort_order）維持以「縣市」分群不變——該排序供前台顧客選取貨點使用。
-- orders / order_items 不更動。

-- 1) 送貨路線表（名稱唯一）。
CREATE TABLE routes (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);

-- 2) 取貨點掛上所屬路線；NULL = 未分路線。
--    ON DELETE RESTRICT：仍有取貨點引用的路線無法被刪除（與資料層計數雙重把關）。
ALTER TABLE pickup_spots
  ADD COLUMN route_id INTEGER REFERENCES routes(id) ON DELETE RESTRICT;
