-- 一次性 migration：為既有環境的 pickup_spots 加上「同縣市內順序」欄 sort_order。
-- 於 Neon SQL Editor 執行一次。依各縣市既有建立序（id）分群回填，確保上線視覺零變動。

ALTER TABLE pickup_spots ADD COLUMN sort_order INTEGER;

UPDATE pickup_spots AS p
SET sort_order = s.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY city ORDER BY id) AS rn
  FROM pickup_spots
) AS s
WHERE p.id = s.id;                                          -- 各縣市內 1..n，確定且唯一

ALTER TABLE pickup_spots ALTER COLUMN sort_order SET NOT NULL;
CREATE INDEX idx_pickup_spots_city_sort ON pickup_spots(city, sort_order);
