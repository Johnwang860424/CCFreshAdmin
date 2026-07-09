# Phase 0 Research: 商品多圖片與排序

本功能無 `NEEDS CLARIFICATION`（圖片上限已於 spec 定為 8）。以下記錄關鍵設計決策。

## D1. 多圖儲存模型：獨立 `product_images` 表為單一真實來源（移除 `products.image_url`）

> **決策更新（使用者確認）**：初版保留 `products.image_url` 作「封面鏡射」以求對 repo 外顧客端零影響。使用者確認本次會一併更新顧客端 App 改讀新來源，故改為**移除** `products.image_url`，封面改為衍生。約束隨之由「既有讀取路徑不變」調整為「既有圖片值不遺失、封面顯示不中斷」。

- **Decision**：新增 `product_images(id, product_id FK CASCADE, image_url, sort_order)`，存單一商品完整有序圖片集合，作為圖片的**唯一真實來源**。遷移將既有 `products.image_url` 值搬入後移除該欄；封面改為讀取時衍生（`images[0]`）。
- **Rationale**：
  - 單一真實來源避免「鏡射欄與集合分歧」的維護負擔與潛在不一致。
  - 一對多有序集合用獨立表最自然，`sort_order` 與既有 `products.sort_order`／`pickup_spots.sort_order` 排序慣例一致，團隊已有 `@dnd-kit` + reorder API 範式可複用。
  - `ON DELETE CASCADE` 讓商品刪除時圖片列自動清除（Cloudinary 檔案另行處理，見 D4）。
- **Alternatives considered**：
  - **保留 `products.image_url` 作封面鏡射**：對 repo 外顧客端零影響，但需在每次寫入同步鏡射、且長期維持一個衍生欄。既然顧客端本次一併更新，改移除更簡潔。棄（初版方案）。
  - **`products.image_urls` JSONB/TEXT[] 欄**：陣列內排序、上限檢查、索引與級聯刪除不如獨立表清晰。棄。

## D2. 封面來源：讀取時衍生，不落地

- **Decision**：不存封面欄。`getProducts` 以子查詢取回有序 `images`，並將 `imageUrl` 設為 `images[0]`（衍生封面）供單圖消費者使用。寫入端（新增商品、`saveProductImages`）只維護 `product_images`，不再更新任何封面欄。
- **Rationale**：封面永遠等於「排序第一張」，衍生即可，無需鏡射欄，也就沒有分歧風險。
- **Alternatives**：保留鏡射欄（見 D1 已棄）；DB trigger 維護——增加隱性複雜度，本專案慣例是應用層處理，不用 trigger。棄。

## D3. 原子寫入：單語句 CTE（沿用既有慣例）

- **Decision**：圖片集合儲存以單一 SQL 語句（CTE + `unnest(... ) WITH ORDINALITY`）完成「刪舊列→插入新有序列→更新封面」；新增商品則「插入 product 取回 id → 插入其圖片列」單語句完成。
- **Rationale**：Neon serverless HTTP 無互動式交易；既有 `reorderProducts` 已用 `unnest WITH ORDINALITY` 單語句達原子（FR-010）。全刪全插對 `product_images` 安全（無外部 FK 指向它）。
- **Alternatives**：`sql.transaction([...])`（driver 支援非互動式多語句交易）亦可，但既有程式一律用單語句 CTE，維持一致性優先。列為備案。

## D4. Cloudinary 生命週期（多圖版）

- **Decision**：
  - **更新集合**：handler 先讀該商品現有圖片 URL 集合，DB 寫入成功後計算「舊−新」差集，逐一 `deleteCloudinaryImage`。
  - **刪除商品**：先讀該商品**全部**圖片 URL，刪 DB 列（CASCADE 清 product_images），再逐一刪 Cloudinary。
  - **Modal 取消**：沿用既有 `uploadedImageUrlsRef`，取消時刪除本次 session 上傳但未存檔的圖。
- **Rationale**：延伸憲章原則 IV 到「多張」；差集刪除避免誤刪仍在集合中的圖，也避免孤兒。
- **Alternatives**：DB 觸發外部刪除——Cloudinary 無 FK，仍須應用層協調，無簡化。棄。

## D5. 上傳與數量上限

- **Decision**：沿用既有 `POST /api/upload`（JPG/PNG/WebP、5MB、magic bytes）逐張上傳，不改上傳端點。數量上限 8 於**前端**（達 8 隱藏上傳格）與**後端驗證**（`validateProductImages` 拒絕 >8 或 <1）雙重把關。
- **Rationale**：上傳驗證維持 server-side（憲章技術約束）；上限雙重把關避免繞過前端。
- **Alternatives**：僅前端限制——可被 API 直呼繞過。棄。

## D6. API 形狀：併入既有 `PUT /api/products/[id]`

- **Decision**：以 `imageUrls: string[]`（有序、封面在 index 0）作為新增/更新商品 body 欄位，取代單一 `imageUrl`；沿用既有 `PUT /api/products/[id]` 與 `POST /api/products`。排序＝送出重排後的完整陣列（與商品列 reorder 的「送完整順序」範式一致），故**不需**另設獨立 reorder 端點。
- **Rationale**：圖片集合恆隨商品編輯一起儲存，合併端點最單純；modal 內即時排序也可只在按「儲存」時一次送出。
- **Alternatives**：獨立 `PUT /api/products/[id]/images` 子路由——若日後要「不開編輯 modal 也能排序」再拆。目前 YAGNI，暫不建。
- **相容**：後端可暫時接受舊 `imageUrl` 單值並轉為 `[imageUrl]`，降低過渡風險（列為實作選項）。
