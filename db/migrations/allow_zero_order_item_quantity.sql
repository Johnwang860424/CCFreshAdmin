-- 請手動在 Neon SQL Editor 執行此檔案。
-- 缺貨批次調整需要保留數量為 0 的訂單明細，而不是刪除歷史快照。
ALTER TABLE order_items
  DROP CONSTRAINT IF EXISTS order_items_quantity_check;

ALTER TABLE order_items
  ADD CONSTRAINT order_items_quantity_check CHECK (quantity >= 0);
