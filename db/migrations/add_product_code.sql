-- 於 Neon SQL Editor 執行以新增產品編號欄位，並將舊資料以 id 補零填入。
ALTER TABLE products ADD COLUMN code VARCHAR(3);
UPDATE products SET code = LEFT(id::text, 3);
ALTER TABLE products ALTER COLUMN code SET NOT NULL;
