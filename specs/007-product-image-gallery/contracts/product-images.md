# Contract: 商品多圖片 API

沿用既有 `app/api/products/*` 端點，將單一 `imageUrl` 升級為有序 `imageUrls` 陣列。所有端點落在 `proxy.ts` 授權 matcher 內（與既有 products 端點一致）。回應沿用 `jsonHandler` 慣例：成功 `{ success: true }` 或資料；失敗 `{ error: string }` 搭配對應 HTTP 狀態。

## 共同驗證：`validateProductImages(imageUrls)`

- `imageUrls` MUST 為陣列，長度 `1 ≤ n ≤ 8`。
- 每個元素 MUST 為非空字串。
- 順序即顯示順序；index 0 為封面。
- 失敗 → 400 `{ error: "商品圖片需為 1 至 8 張" }`（或等義訊息）。

過渡相容（可選）：若 body 僅帶舊 `imageUrl` 字串而無 `imageUrls`，後端視為 `[imageUrl]`。

## `GET /api/products`

- 回應每筆商品新增 `images: string[]`（依序，長度 1–8）；`imageUrl` 續為封面（= `images[0]`）。既有欄位不變。

## `POST /api/products`（新增商品）

**Request body**（既有欄位 + 圖片）：

```json
{
  "name": "無糖豆漿",
  "price": 50,
  "imageUrls": ["https://res.cloudinary.com/.../a.jpg", "https://.../b.jpg"],
  "categoryId": 3,
  "spec": "500g/包",
  "description": "…",
  "promoType": null,
  "promoConfig": null
}
```

- `imageUrls` 經 `validateProductImages`；其餘欄位沿用既有 `validateProductBody`。
- 行為：單一原子語句插入 `products`（無圖片欄）＋各 `product_images`（`sort_order` 1..n，封面即第一張）。
- 成功 `{ success: true }`。

## `PUT /api/products/[id]`（更新商品 + 圖片集合/排序）

**Request body**：既有可編輯欄位 + `imageUrls`（重排／增刪後的完整有序陣列）。

- 行為：`saveProductImages` 單一原子語句全刪該商品 `product_images` → 依 `imageUrls` 順序全插（封面即第一張，衍生）；另更新其餘商品欄位。
- **Cloudinary**：handler 於 DB 寫入成功後，計算「舊圖 URL 集合 − 新 `imageUrls`」差集並逐一刪除（避免孤兒；不誤刪仍在集合中的圖）。
- 成功 `{ success: true }`；圖片驗證失敗 400。

## `DELETE /api/products/[id]`（刪除商品）

- 行為：先讀該商品**全部** `product_images.image_url` → 刪 `products`（CASCADE 連帶清 `product_images`）→ 逐一刪除全部 Cloudinary 檔。
- 成功 `{ success: true }`。

## 排序

- **不新增獨立 reorder 端點**。圖片排序透過 `PUT /api/products/[id]` 送出重排後的完整 `imageUrls` 完成（與商品列 reorder 的「送完整順序」範式一致）。

## 上傳

- 沿用既有 `POST /api/upload`（JPG/PNG/WebP、5MB、magic bytes 驗證）逐張上傳，回傳 `{ url }`；本功能不變更上傳端點。前端於已達 8 張時隱藏上傳入口。
