-- 一次性 migration：新增商品多圖表 product_images，將既有商品的單張圖片回填為第一張（封面），
-- 並移除 products.image_url（圖片改由 product_images 統一管理）。
-- 於 Neon SQL Editor 執行。失敗安全且可重跑：
--   * 整段以 BEGIN/COMMIT 包住 → 任一步失敗即全部回滾，不留半套。
--   * 建表/索引皆 IF NOT EXISTS；回填＋移除欄位包在「欄位仍存在」的判斷內 → 重跑不重複、不報錯。
--
-- ⚠️ 部署協調：products.image_url 移除後，仍讀取該欄的舊版顧客端 App 會失敗。
--    請在套用本 migration 的同時，一併上線改讀 product_images 的後台與顧客端。

BEGIN;

-- 1) 多圖表：單一商品的有序圖片集合；商品刪除時級聯清除圖片列。
CREATE TABLE IF NOT EXISTS product_images (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url   TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_product_images_product
  ON product_images(product_id, sort_order);

-- 2) 僅在 products.image_url 仍存在時，回填既有單圖為第一張，然後移除該欄。
--    以 information_schema 判斷 → 重跑（欄位已移除）時整塊略過，達冪等。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'image_url'
  ) THEN
    -- 每個尚無圖片列的既有商品，其現有單圖成為 sort_order=1（封面）。
    INSERT INTO product_images (product_id, image_url, sort_order)
    SELECT p.id, p.image_url, 1
    FROM products p
    WHERE NOT EXISTS (
      SELECT 1 FROM product_images pi WHERE pi.product_id = p.id
    );

    ALTER TABLE products DROP COLUMN image_url;
  END IF;
END $$;

COMMIT;
