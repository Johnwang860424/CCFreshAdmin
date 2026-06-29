-- 一次性 migration：為既有環境的 orders 加上訂單來源標籤欄位 tag。
-- 於 Neon SQL Editor 執行一次。

ALTER TABLE orders ADD COLUMN tag TEXT NOT NULL DEFAULT '網站';
