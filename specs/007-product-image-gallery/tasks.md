# Tasks: 商品多圖片與排序 (Product Image Gallery)

**Input**: Design documents from `specs/007-product-image-gallery/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/product-images.md ✅

**Tests**: 本專案無測試框架（憲章 Development Workflow）。不產生自動化測試任務；驗證以 `npm run lint`＋`npm run build`＋quickstart.md 手動場景把關。

**Organization**: 依 user story 分組。US1（多圖上傳/移除，P1）為 MVP；US3（既有資料不受影響，P1）為資料安全保證；US2（排序，P2）為增益。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、無未完成相依）
- **[Story]**: US1 / US2 / US3
- 每個任務含明確檔案路徑

## Path Conventions

單一 Next.js 專案（repo root）。資料層 `app/lib/`、API `app/api/`、頁面 `app/(admin)/`、schema/migration `db/`。

---

## Phase 1: Setup

**Purpose**: 確認前置，無需新增套件。

- [X] T001 確認位於 feature 範圍且相依齊備：`@dnd-kit/*` 已存在於 `package.json`（商品列排序已用），本功能不新增套件；Cloudinary／Neon env 已就緒。無程式變更，僅檢查。

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 建立所有 story 共用的 DB 骨架與讀取形狀。**⚠️ 完成前任何 story 無法運作。**

- [X] T002 於 `db/schema.sql` 新增 `product_images` 表定義（`id` SERIAL PK、`product_id` INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE、`image_url` TEXT NOT NULL、`sort_order` INTEGER NOT NULL）與索引 `idx_product_images_product (product_id, sort_order)`；並自 `products` 移除 `image_url` 欄（圖片改由 `product_images` 管理）。
- [X] T003 建立 `db/migrations/005_add_product_images.sql`，**expand-then-contract、失敗安全且可重跑**（FR-012/FR-013）：整段以 `BEGIN; … COMMIT;` 包住（中途失敗全部回滾）；`CREATE TABLE/INDEX IF NOT EXISTS`；於 `DO` 區塊內僅當 `products.image_url` 仍存在時，先防重複回填（`SELECT p.image_url ... WHERE NOT EXISTS (... product_images ...)`）再 `ALTER TABLE products DROP COLUMN image_url`；重跑（欄已移除）整塊略過。註明部署協調：與改讀新來源的後台＋顧客端同時上線。
- [X] T004 [P] 於 `app/lib/validation.ts` 新增 `validateProductImages(imageUrls)`：驗證為陣列、長度 1–8、每元素為非空字串；失敗回傳 400 `{ error: "商品圖片需為 1 至 8 張" }`。
- [X] T005 於 `app/lib/products.ts` 修改 `getProducts`：以子查詢彙整每商品之 `product_images`（`ORDER BY sort_order`）為有序 `images: string[]`；`ProductDbRow` 移除 `image_url`、`ProductRow` 新增 `images`，`imageUrl` 改為衍生封面（`images[0] ?? ""`，`products` 已無 image_url 欄）。

**Checkpoint**: 資料表、遷移、驗證器、讀取形狀就緒；`imageUrl` 改為衍生封面仍可正常讀取。

---

## Phase 3: User Story 3 - 既有商品資料不受影響 (Priority: P1) 🎯 資料安全

**Goal**: 遷移 expand-then-contract：既有圖片值搬入 `product_images` 成為第一張（封面）後移除舊欄，無圖片值遺失、封面顯示不中斷。

**Independent Test**: 選一個從未經本功能編輯的既有商品，確認原圖值已成為唯一且排第一的 `product_images` 列、後台封面與上線前一致，商品筆數不變、`products` 已無 image_url 欄（quickstart 場景 F、SC-006）。

- [X] T006 [US3] 套用前先記下商品數與抽樣 `products.image_url`；於 Neon SQL Editor 套用 `db/migrations/005_add_product_images.sql`；套用後驗證 `count(product_images)` 等於原商品數、抽樣商品原值已成為其 `product_images`(sort_order=1)、`products` 已無 `image_url` 欄（information_schema 查無）。
- [X] T007 [US3] 迴歸確認封面不中斷：`GET /api/products` 每筆 `imageUrl`（衍生自 images[0]）非空且為第一張、後台 `app/(admin)/products/page.tsx` 商品列圖片欄顯示與上線前相同；顧客端本次一併更新為讀新來源（repo 外，另行驗證）。

**Checkpoint**: 既有圖片值完整搬入、封面持續正常顯示，舊欄已移除。

---

## Phase 4: User Story 1 - 為商品新增多張圖片 (Priority: P1) 🎯 MVP

**Goal**: 管理員可為單一商品上傳多張圖片、移除個別圖片；下限 ≥1、上限 ≤8；商品刪除清全部圖，無 Cloudinary 孤兒。

**Independent Test**: 編輯既有商品上傳至 3 張並儲存，重整仍在；移除到剩 1 張成功、再移除被阻止；刪除商品後其全部圖片列與 Cloudinary 檔皆消失（quickstart 場景 A、C、E）。

### 資料層（`app/lib/products.ts`，同檔循序）

- [X] T008 [US1] 改寫 `addProduct`：改收 `imageUrls: string[]`，以單一原子 CTE 插入 `products`（無圖片欄）並回傳新 id，接著插入其 `product_images`（`unnest WITH ORDINALITY` 給 `sort_order` 1..n）。
- [X] T009 [US1] 新增 `saveProductImages(productId, imageUrls)`：單一原子 CTE 全刪該商品 `product_images` → 依序全插（封面即 sort_order=1，不另存欄位）。供更新/排序共用。
- [X] T010 [US1] 新增 `getProductImageUrls(id): Promise<string[]>`（不經快取），回傳該商品全部 `image_url`，供刪除/差集清理 Cloudinary 使用；保留既有 `getProductImageUrl` 或以此取代其呼叫點。

### API（不同檔案，部分可平行）

- [X] T011 [P] [US1] 更新 `app/api/products/route.ts` POST：以 `validateProductImages` 驗證 `imageUrls`，改呼叫新版 `addProduct(... imageUrls ...)`；沿用 `validateProductBody` 驗其餘欄位。
- [X] T012 [US1] 更新 `app/api/products/[id]/route.ts` PUT：接收 `imageUrls[]`（`validateProductImages`），先 `getProductImageUrls` 取舊集合 → `saveProductImages` 寫入 → 計算「舊−新」差集並逐一 `deleteCloudinaryImage`（取代原單張 `oldImageUrl` 邏輯）。
- [X] T013 [US1] 更新 `app/api/products/[id]/route.ts` DELETE：改以 `getProductImageUrls` 取全部圖 → `deleteProduct`（CASCADE 清 `product_images`）→ 逐一 `deleteCloudinaryImage` 全部圖（取代原單張刪除）。

### 前端（`app/(admin)/products/page.tsx`）

- [X] T014 [US1] 改造 modal 圖片區為多圖：以陣列 state 管理 `imageUrls`；上傳成功 append；每張縮圖可移除；達 8 張隱藏上傳入口，儲存時若 0 張則阻擋並提示「至少一張」；`handleSave` 送 `imageUrls`（POST/PUT）；`uploadedImageUrlsRef` 追蹤本 session 上傳、取消時清理（延伸既有機制到多張）。

**Checkpoint**: 多圖新增/移除端到端可用，數量邊界與孤兒清理到位（MVP 完成）。

---

## Phase 5: User Story 2 - 調整圖片顯示順序 (Priority: P2)

**Goal**: 管理員於 modal 內拖拉調整圖片順序，第一張即封面；順序永久保存。

**Independent Test**: 對有 3 張圖的商品把第 3 張拖到第 1 位並儲存，重整後新順序保留、封面（列表 `imageUrl`）變為新的第一張（quickstart 場景 B）。

- [X] T015 [US2] 於 `app/(admin)/products/page.tsx` modal 圖片區加入 `@dnd-kit` 縮圖拖拉排序（重排本地 `imageUrls` 狀態；沿用頁面既有 `@dnd-kit` import 與 sensor 慣例）。
- [X] T016 [US2] 驗證儲存後順序與封面持久化：因 `saveProductImages`（T009）已依送出順序寫 `sort_order`，且封面為衍生（`imageUrl = images[0]`），確認 PUT 後 `getProducts` 之 `images`/`imageUrl` 反映新序；無額外端點（見 research D6）。

**Checkpoint**: US1＋US2 皆可獨立運作，封面隨排序即時反映。

---

## Phase 6: Polish & Cross-Cutting

- [X] T017 [P] 更新 `CLAUDE.md` Data layer 段落：說明 `product_images` 表為圖片唯一真實來源、`products` 已移除 image_url、封面衍生自 images[0]、圖片增刪的 Cloudinary 差集清理規則。
- [X] T018 執行 `npm run lint` 與 `npm run build`，修正任何錯誤（憲章 Development Workflow 完成門檻）。
- [X] T019 依 `specs/007-product-image-gallery/quickstart.md` 跑完場景 A–F，確認多圖、排序、下限/上限、刪除清圖、遷移不遺失既有圖片值皆符合。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1)**：無相依，可立即開始。
- **Foundational (P2)**：依賴 Setup；**阻擋所有 story**。
- **US3 (P3 phase)**：依賴 Foundational（需 T003 遷移檔）；套用並驗證遷移。
- **US1 (P4 phase)**：依賴 Foundational（T004 驗證器、T005 讀取形狀）；建議先套用 T006 遷移以便對真實資料測試。
- **US2 (P5 phase)**：依賴 US1 的 `saveProductImages`（T009）與 modal 多圖 UI（T014）。
- **Polish (P6)**：依賴前述完成。

### User Story Dependencies

- **US3 (P1)**：僅依賴 Foundational，獨立可測（遷移正確性）。
- **US1 (P1)**：僅依賴 Foundational，獨立可測（多圖 CRUD）。
- **US2 (P2)**：依賴 US1（排序作用於 US1 建立的多圖集合與 UI）。

### Within Each Story

- 資料層（products.ts）→ API → 前端。
- `app/lib/products.ts`（T005, T008, T009, T010）為同檔，須循序。
- `app/(admin)/products/page.tsx`（T014, T015）為同檔，US1 先於 US2，不可平行。

### Parallel Opportunities

- T004（validation.ts）可與 T002/T003（db/）平行。
- T011（POST route）可與 T012/T013（[id] route，另一檔）中之獨立部分平行；T012 與 T013 同檔須循序。
- T017（CLAUDE.md）可與程式任務平行。

---

## Parallel Example: Foundational

```bash
# T004 與 DB 檔案任務可同時進行（不同檔案）：
Task: "新增 validateProductImages 於 app/lib/validation.ts"
Task: "新增 product_images 定義於 db/schema.sql"
Task: "建立 db/migrations/005_add_product_images.sql"
```

---

## Implementation Strategy

### MVP First

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US3（套用+驗證遷移）→ 4. Phase 4 US1。
5. **STOP & VALIDATE**：跑 quickstart 場景 A/C/E/F，確認多圖新增/移除/刪除清圖與遷移不遺失既有圖片值。可交付（MVP：多圖 + 資料安全）。

### Incremental Delivery

1. Foundational + US3 → 既有資料在新結構下完好（可先上線遷移，行為與現況相同）。
2. + US1 → 多圖上傳/移除（MVP）。
3. + US2 → 圖片拖拉排序（封面可調）。
4. Polish → 文件、lint/build、quickstart 全場景。

---

## Notes

- [P] = 不同檔案、無相依。
- 圖片集合寫入一律單語句 CTE 保原子（FR-010）；Cloudinary 差集/全刪清理避免孤兒（憲章原則 IV）。
- 封面為衍生（`imageUrl = images[0]`），`products` 已無圖片欄（FR-004）。
- 遷移 expand-then-contract：先搬移既有圖片值再移除舊欄，值不遺失（FR-006/FR-007/FR-012/FR-013、SC-006）；與顧客端更新同時上線。
- 每完成一任務或邏輯群組即 commit；於各 Checkpoint 可獨立驗證。
