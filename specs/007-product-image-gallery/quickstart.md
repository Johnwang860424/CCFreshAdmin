# Quickstart 驗證指南：商品多圖片與排序

驗證多圖上傳、排序、衍生封面，以及既有圖片值在遷移中不遺失。細節見 [data-model.md](./data-model.md)、[contracts/product-images.md](./contracts/product-images.md)。

## 前置

1. 套用 migration：於 Neon SQL Editor 執行 `db/migrations/005_add_product_images.sql`（新增 `product_images` 並回填每個既有商品一筆）。
2. 環境變數齊備（`DATABASE_URL`、`CLOUDINARY_*` 等）。
3. `npm run dev` 啟動；以允許清單內帳號登入後台。

## 驗證前先確認基準（既有圖片值不遺失）

- **套用 migration 前**先記下既有商品數與抽樣圖片：`SELECT count(*) AS n FROM products;`、`SELECT id, image_url FROM products;`。
- **套用 migration 後**：
  - `SELECT count(*) FROM product_images;` 應等於先前的商品數（每商品剛好 1 圖）。
  - 先前記下的商品，其原 `image_url` 已成為 `product_images`（`sort_order=1`）之值 → 值搬移未遺失。
  - `products` 已無 `image_url` 欄（`SELECT column_name FROM information_schema.columns WHERE table_name='products';` 不含 image_url）。
- 後台商品列封面（衍生自 images[0]）與上線前相同；顧客端（本次一併更新為讀 `product_images`）封面顯示正常。

## 場景 A — 為既有商品新增多張圖片（US1 / SC-001）

1. 商品管理 → 對既有商品按編輯。
2. 圖片區應顯示原圖為第一張（封面）。
3. 再上傳 4 張 → 共 5 張 → 儲存。（對應 SC-001「至少 5 張」）
4. **預期**：重新整理後仍 5 張且全部正確顯示；`SELECT image_url,sort_order FROM product_images WHERE product_id=<id> ORDER BY sort_order` 為 1..5；`GET /api/products` 該商品 `imageUrl` = 第一張、`images` 長度 5。

## 場景 B — 拖拉調整圖片順序（US2）

1. 編輯上述商品，將第 3 張拖到第 1 位 → 儲存。
2. **預期**：重新整理後新順序保留；衍生封面 `imageUrl`（= images[0]）已變為新的第一張（封面隨排序改變）。

## 場景 C — 移除圖片與下限保護（US1 邊界）

1. 編輯商品，移除到剩 1 張 → 儲存成功。
2. 再嘗試移除最後一張 → **預期**：被阻止並提示「至少保留一張」，無法存成 0 張。
3. 被移除的圖對應的 Cloudinary 檔應已刪除（無孤兒）。

## 場景 D — 數量上限 8（邊界）

1. 持續上傳至 8 張 → **預期**：達 8 張後上傳入口消失／被禁用。
2. 直呼 `PUT /api/products/[id]` 帶 9 個 URL → **預期**：400，訊息「1 至 8 張」。

## 場景 E — 刪除商品清空全部圖（FR-008）

1. 刪除一個有多張圖的商品。
2. **預期**：`product_images` 該商品列全數消失（CASCADE）；其全部 Cloudinary 檔皆被刪除，無孤兒殘留。

## 場景 F — 遷移不遺失既有圖片（US3 / SC-006）

1. 選一個從未經本功能編輯的既有商品。
2. **預期**：其原圖成為唯一且排第一的 `product_images` 列，後台列表／顧客端封面顯示與上線前一致；商品筆數不變、既有圖片值完整搬入（僅 `products.image_url` 欄被移除，值已保存在 `product_images`）。

## 收尾檢查

- `npm run lint` 與 `npm run build` 皆通過。
- 圖片增／刪／排序若儲存失敗，前端還原到操作前集合（無半套順序）。
