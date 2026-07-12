-- 007: 商品庫存（剩餘可售計數器）。
-- 於 Neon SQL Editor 手動執行一次。
--
-- stock 為 nullable：NULL＝不限量（不追蹤庫存），既有商品不回填、行為不變；
-- 0＝售完。具名 CHECK 為防超賣的最終防線——訂單寫入與庫存扣減在同一條
-- SQL 語句內，任一商品扣到負值即違反此約束、整句原子失敗（零部分效果）。
-- 應用層依 SQLSTATE 23514 + constraint 名 products_stock_nonneg 分流為
-- 「庫存不足」的友善錯誤訊息，勿更名。

ALTER TABLE products
  ADD COLUMN stock INTEGER,
  ADD CONSTRAINT products_stock_nonneg CHECK (stock IS NULL OR stock >= 0);
