-- 一次性 migration：取貨號流水號改為「每取貨點 × 來源 tag」各自獨立遞增
-- （FB / Line / 網站 分別從 1 起算；宅配的 pickup_spot_id IS NULL 作用域同樣依來源分開）。
-- 於 Neon SQL Editor 執行。
-- 既有資料在舊約束（不分來源）下已唯一，放寬為含 tag 的唯一鍵必然相容，無需回填。

-- 1) 刪除原本不分來源的唯一約束
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pickup_spot_id_pickup_number_key;

-- 2) 重新建立含來源 tag 的唯一約束（NULLS NOT DISTINCT 讓宅配的 NULL 取貨點也受約束）
ALTER TABLE orders ADD CONSTRAINT orders_pickup_spot_id_tag_pickup_number_key
  UNIQUE NULLS NOT DISTINCT (pickup_spot_id, tag, pickup_number);
