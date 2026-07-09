# Implementation Plan: 商品多圖片與排序 (Product Image Gallery)

**Branch**: `007-product-image-gallery` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-product-image-gallery/spec.md`

## Summary

商品從「單張圖片」擴充為「一組有序圖片（1–8 張）」，管理員可上傳多張、拖拉排序、移除個別圖片；排序第一張即封面。核心約束（本次已與使用者調整）：**既有圖片值不遺失、封面顯示不中斷**（顧客端 App 本次一併更新改讀新來源）。技術做法：新增 `product_images` 表作為圖片**唯一真實來源**，封面改為讀取時衍生（`images[0]`）。結構異動以獨立 migration（`db/migrations/005_...`）交付，採 expand-then-contract：先回填每個既有商品一筆 `product_images`（sort_order=1，沿用其現有 image_url 值），確認搬移後再移除 `products.image_url` 欄；整段交易化＋冪等，不遺失任何既有圖片值、不動其他既有列。

## Technical Context

**Language/Version**: TypeScript strict / Next.js 16.2.4 / React 19

**Primary Dependencies**: antd v6、`@dnd-kit/*`（既有拖拉排序）、`@neondatabase/serverless`（Neon HTTP tagged-template）、Cloudinary（`CC` 資料夾）

**Storage**: Neon Postgres — 新增 `product_images` 表（圖片唯一真實來源）；移除 `products.image_url`，封面改為衍生

**Testing**: 無測試框架；以 `npm run lint`＋`npm run build`＋手動驗證（quickstart.md）把關

**Target Platform**: Next.js App Router web（後台管理端）

**Project Type**: Web application（單一 Next.js 專案，非前後端分離）

**Performance Goals**: 排序/儲存操作使用者 1 秒內看到結果（樂觀更新）；商品列表以封面欄呈現，載入行為與現況一致

**Constraints**: 既有圖片值不遺失、封面顯示不中斷（遷移 expand-then-contract；顧客端本次一併更新）；單商品圖片上限 8；上傳驗證沿用 JPG/PNG/WebP＋5MB（magic bytes）；SQL 必經 tagged template 參數化；圖片增刪一律避免 Cloudinary 孤兒；圖片集合寫入須原子（單語句 CTE）

**Scale/Scope**: 少量管理員、低併發；商品數量級數百；每商品 ≤8 圖

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Read Bundled Docs Before Framework Code** — 本功能主要動資料層與一個既有 client 頁面；不新增 middleware/`proxy` 或 server/client 邊界變更。若途中需調整任何框架級行為，先讀 `node_modules/next/dist/docs/`。**PASS**。
- **II. Parameterized SQL Only (NON-NEGOTIABLE)** — 新查詢全數集中於 `app/lib/products.ts`，經 `sql` tagged template；圖片 URL 陣列以 `unnest(${urls}::text[])` 參數化傳入，無字串拼接。**PASS**。
- **III. Deny-by-Default Authorization** — 新端點 `PUT /api/products/[id]/images`（或併入既有 `PUT /api/products/[id]`）落在 `proxy.ts` matcher 內，沿用既有 `/api/products/*` 授權模式。**PASS**（與既有 products 端點一致）。
- **IV. No Orphaned Images** — 移除圖片時比對舊集合−新集合，DB 寫入後刪 Cloudinary；商品刪除先撈全部圖 URL 再刪列、後刪 Cloudinary；modal 取消沿用 `uploadedImageUrlsRef` 清理。**PASS**（多圖版延伸既有規則）。
- **V. Orders Mutable Until Shipment, Immutable in History** — 不動 `orders`/`order_items`；`order_items` 不含圖片欄，其快照不受影響（移除 `products.image_url` 與訂單無關）。**PASS**。

**Technology constraints**：更動的頁面 `products/page.tsx` 已是 `"use client"`；上傳驗證維持 server-side（`app/api/upload`）不動；UI 文案 zh-TW。**無違規，Complexity Tracking 免填。**

## Project Structure

### Documentation (this feature)

```text
specs/007-product-image-gallery/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── product-images.md
└── tasks.md             # Phase 2 output (/speckit-tasks — 尚未建立)
```

### Source Code (repository root)

```text
db/
├── schema.sql                              # 新增 product_images；products 移除 image_url
└── migrations/
    └── 005_add_product_images.sql          # 新：expand-then-contract（回填後移除 image_url）

app/
├── lib/
│   ├── products.ts                         # 改：查詢衍生 images[]＋封面 imageUrl；新增/更新/刪除連動 product_images（不再寫 image_url）
│   └── validation.ts                       # 改：新增 validateProductImages（陣列、1–8、皆非空字串）
├── api/
│   └── products/
│       ├── route.ts                        # 改：POST 接收 imageUrls[]（新增商品連同多圖）
│       └── [id]/
│           └── route.ts                    # 改：PUT 接收 imageUrls[]；DELETE 清全部圖
└── (admin)/products/page.tsx               # 改：多圖上傳格＋圖片拖拉排序＋移除（≤8）
```

**Structure Decision**：沿用既有單一 Next.js 專案結構與「每實體一資料模組」慣例。圖片集合的儲存/排序邏輯集中於 `app/lib/products.ts`，API 沿用既有 `app/api/products/*` 佈局；前端沿用 `@dnd-kit`（商品列已用它做列排序）於 modal 內做圖片縮圖排序。是否新增 `[id]/images/route.ts` 子路由 vs. 併入 `[id]` PUT，於 research.md 決策。

## Complexity Tracking

> 無 Constitution 違規，本節免填。
