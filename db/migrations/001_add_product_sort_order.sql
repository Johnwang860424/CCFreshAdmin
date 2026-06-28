-- 一次性 migration：為既有環境的 products 加上顯示順序欄位 sort_order。
-- 於 Neon SQL Editor 執行一次。以既有建立序（id）回填，確保上線視覺零變動。

ALTER TABLE products ADD COLUMN sort_order INTEGER;
UPDATE products SET sort_order = id;                       -- 以既有建立序回填，確定且唯一
ALTER TABLE products ALTER COLUMN sort_order SET NOT NULL;
CREATE INDEX idx_products_sort_order ON products(sort_order);
