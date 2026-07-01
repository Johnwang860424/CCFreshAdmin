-- 一次性 migration：將 orders 唯一約束改為 UNIQUE NULLS NOT DISTINCT，防止宅配訂單 (pickup_spot_id 為 NULL) 於高併發下重號
-- 於 Neon SQL Editor 執行。

-- 1) 刪除原本的唯一約束（Postgres 預設命名的唯一鍵名稱為 orders_pickup_spot_id_pickup_number_key）
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pickup_spot_id_pickup_number_key;

-- 2) 重新建立改用 NULLS NOT DISTINCT 的唯一約束
ALTER TABLE orders ADD CONSTRAINT orders_pickup_spot_id_pickup_number_key 
  UNIQUE NULLS NOT DISTINCT (pickup_spot_id, pickup_number);
