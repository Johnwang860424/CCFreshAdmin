# Phase 1 Data Model: 商品多圖片與排序

## 新增表：`product_images`

單一商品的有序圖片集合。

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| `id` | SERIAL | PRIMARY KEY | 識別碼（canonical id，`rowKey`/API 段）。 |
| `product_id` | INTEGER | NOT NULL, REFERENCES `products(id)` **ON DELETE CASCADE** | 所屬商品；商品刪除時圖片列自動清除。 |
| `image_url` | TEXT | NOT NULL | Cloudinary 圖片 URL（標準 `/upload/...` 形式，供 `deleteCloudinaryImage` 解析 public id）。 |
| `sort_order` | INTEGER | NOT NULL | 商品內顯示順序，1-based；`sort_order = 1` 為封面。 |

**索引**：`CREATE INDEX idx_product_images_product ON product_images(product_id, sort_order);`

**排序語意**：`sort_order` 於**單一商品內**唯一、可比較（與 `pickup_spots.sort_order` 的縣市分群類似，此處以 `product_id` 分群）。查詢一律 `ORDER BY product_id, sort_order`。

**不變式**：
- 每個商品至少 1 筆、至多 8 筆 `product_images`（應用層 `validateProductImages` 保證；DB 不設 CHECK，靠寫入端）。
- 封面 = 該商品 `sort_order` 最小（=1）之列；為**唯一真實來源**，不另存欄位。讀取時由 `getProducts` 衍生為 `imageUrl`。

## 既有表變更：`products`

- **移除 `image_url` 欄**（migration 005）。商品圖片改由 `product_images` 統一管理；封面改為衍生（images[0]），不再存於 `products`。
- 所有讀取 `products.image_url` 的路徑（顧客端 App、後台列表、訂單顯示的間接依賴）**須改讀 `product_images`／衍生封面**。顧客端 App 於本次一併更新（在本 repo 範圍外）。

## 既有表：`orders` / `order_items`

- **不變更**。`order_items` 不含圖片欄；訂單快照不受多圖影響。

## 遷移（先回填、再移除舊欄；資料不遺失）

`db/migrations/005_add_product_images.sql`（於 Neon SQL Editor 執行）。**失敗安全且可重跑**（FR-013）——整段以 `BEGIN; … COMMIT;` 包住，任一步失敗即全部回滾、不留半套；DDL 皆冪等，回填＋移除欄位包在「欄位仍存在」判斷內：

1. `CREATE TABLE IF NOT EXISTS product_images (...)` 與 `CREATE INDEX IF NOT EXISTS ...`。
2. 於 `DO` 區塊內，僅當 `products.image_url` 仍存在時：
   - 防重複回填 `INSERT ... SELECT p.id, p.image_url, 1 FROM products p WHERE NOT EXISTS (... product_images ...)` — 既有單圖成為第一張（封面），既有值先搬進 `product_images` 不遺失。
   - `ALTER TABLE products DROP COLUMN image_url` — 搬移完成後移除舊欄。
3. 重跑（欄位已移除）→ 整塊略過，達冪等。

⚠️ **部署協調**：移除欄位後，仍讀 `products.image_url` 的舊版顧客端會失敗；本 migration 須與「改讀 `product_images` 的後台＋顧客端」同時上線。

同步更新 `db/schema.sql`：新增 `product_images` 定義、移除 `products.image_url`。

## 對外資料形狀（`app/lib/products.ts` → `ProductRow`）

- `imageUrl` 改為**衍生封面**（= images[0]，無圖時空字串），不再對應 DB 欄位；供單圖消費者（後台列表、顧客端）沿用。
- 新增 `images: string[]` — 依 `sort_order` 排好的完整 URL 陣列（長度 1–8）。

## State / 生命週期

- **新增商品**：插入 `products`（無圖片欄）＋ N 筆 `product_images`（單一原子語句）。
- **編輯圖片集合**：以送來的完整有序 `imageUrls` 全刪全插 `product_images`（單一原子語句）；差集舊圖刪 Cloudinary。
- **刪除商品**：讀全部圖 URL → 刪 `products`（CASCADE 清 `product_images`）→ 刪全部 Cloudinary 檔。
