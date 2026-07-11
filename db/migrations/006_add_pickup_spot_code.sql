-- 一次性 migration：pickup_spots 新增「站點代碼」欄 code（取貨號碼前綴，管理員可維護）。
-- 於 Neon SQL Editor 執行一次。
-- 回填規則（使用者裁決）：同一路線（route_id；NULL = 未分路線自成一組）內依站點建立序（id）
-- 編 A、B、C…（Excel 式雙射 26 進位，27 → AA），每條路線都從 A 重新起算。
-- ⚠️ 既有未出貨訂單的取貨號「前綴」會隨新代碼即時改變（流水號不變）——請於非出貨作業時段執行，
--    並與現場同步以新號碼為準。orders / order_items 不更動。

-- 1) 先以 nullable 加欄，回填後再上約束。
ALTER TABLE pickup_spots ADD COLUMN code TEXT;

-- 2) 依路線分組回填：row_number()（組內依 id）→ Excel 式字母（1→A…26→Z、27→AA…，支援至三碼）。
WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY route_id ORDER BY id)::int AS rn
  FROM pickup_spots
)
UPDATE pickup_spots AS p
SET code = CASE
  WHEN n.rn <= 26  THEN chr(64 + n.rn)
  WHEN n.rn <= 702 THEN chr(64 + ((n.rn - 27) / 26) + 1)
                     || chr(65 + (n.rn - 1) % 26)
  ELSE chr(64 + ((n.rn - 703) / 676) + 1)
     || chr(65 + ((n.rn - 27) / 26) % 26)
     || chr(65 + (n.rn - 1) % 26)
END
FROM numbered AS n
WHERE p.id = n.id;

-- 3) 約束：格式（1–3 大寫英文字母）＋同路線內唯一。
--    UNIQUE NULLS NOT DISTINCT 讓「未分路線」（route_id IS NULL）群組同樣強制唯一（PG15+，
--    與 orders 的 (pickup_spot_id, pickup_number) 唯一鍵同語法）。
--    顯式命名 constraint，供資料層依 err.constraint 分流錯誤訊息。
ALTER TABLE pickup_spots
  ALTER COLUMN code SET NOT NULL;
ALTER TABLE pickup_spots
  ADD CONSTRAINT pickup_spots_code_format_check CHECK (code ~ '^[A-Z]{1,3}$');
ALTER TABLE pickup_spots
  ADD CONSTRAINT pickup_spots_route_id_code_key UNIQUE NULLS NOT DISTINCT (route_id, code);
