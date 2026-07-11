# CC 生鮮 — Admin Backend

CC 生鮮 (CC Fresh) 後台管理系統。管理員透過此後台維護取貨點與商品、處理訂單結單與匯出。介面為繁體中文 (`zh-TW`)。

> 訂單與訂單明細由外部顧客端應用寫入，本後台僅負責讀取、匯出 (結單 CSV) 與清除。

## 技術架構

- **Next.js 16.2.4 / React 19 / TypeScript (strict)** — App Router，路徑別名 `@/*` → 專案根目錄。
- **antd v6** — 全部 UI，透過 `@ant-design/nextjs-registry` 處理 SSR 樣式。互動頁面皆為 `"use client"`。
- **NextAuth v5 (Auth.js, beta)** — Google OAuth，JWT session（不使用資料庫 session）。
- **Neon Postgres** — 以 `@neondatabase/serverless` HTTP driver 執行原生 SQL。
- **Cloudinary** — 商品多圖上傳/刪除（`CC` 資料夾）。

## 快速開始

```bash
npm install
npm run dev
```

開啟 [http://localhost:3000](http://localhost:3000)。

### 指令

- `npm run dev` — 開發伺服器
- `npm run build` — 正式建置
- `npm run start` — 啟動正式建置
- `npm run lint` — ESLint（flat config，`eslint.config.mjs`）

目前未設定測試框架。

## 環境變數

複製 `.env.local.example` 為 `.env.local` 並填入：

| 變數 | 用途 |
| --- | --- |
| `AUTH_SECRET` | NextAuth 簽章密鑰 |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth 憑證 |
| `ALLOWED_EMAILS` | 登入白名單（逗號分隔，留空＝禁止所有人登入） |
| `DATABASE_URL` | Neon Postgres 連線字串（pooled 即可） |
| `CLOUDINARY_*` | Cloudinary 圖片上傳設定 |

## 專案結構

- `app/(admin)/` — 受保護的後台頁面（取貨點、商品、訂單、結單等）。`layout.tsx` 於伺服器端呼叫 `auth()` 並渲染 `AdminShell`。
- `app/api/{products,categories,routes,pickup-spots,orders,upload}/` — REST handlers（集合 `route.ts`、單筆 `[id]/route.ts`）。
- `app/lib/` — 資料層，每個 entity 一個模組（`products.ts`、`pickup-spots.ts`、`orders.ts`…），以 `db.ts` 匯出的 `sql` tagged template 查詢（自動參數化）。
- `auth.ts` — 單一 NextAuth 設定，匯出 `handlers / auth / signIn / signOut`。
- `proxy.ts` — 中介層（Next.js 16 將 `middleware` 更名為 `proxy`），未登入導向 `/login`。
- `db/schema.sql` — 資料表 schema（`categories`, `products`, `product_images`, `routes`, `pickup_spots`, `orders`, `order_items`），對 Neon 執行一次。

## 重點慣例

- **身分識別與排序**：身分識別為 serial `id` 欄位（API 路由段為 `[id]`，antd 表格 `rowKey="id"`）。商品 (`products.sort_order`) 與自取點 (`pickup_spots.sort_order`) 皆有維護顯示順序。
- **商品多圖與排序**：`product_images` 表為商品圖片的單一事實來源（每個商品限制 1–8 張圖，`sort_order=1` 為封面）。圖片生命週期由 API 協調以避免孤兒檔（變動才刪、刪除商品級聯清除 Cloudinary 圖片、取消編輯即時刪除未儲存暫存檔）。
- **取貨點與送貨路線**：取貨點可選擇歸屬 `routes` 路線。
- **取貨號與站點代碼**：取貨號前綴改由管理員可維護的站點代碼 `pickup_spots.code` 欄位（1–3 大寫英文字母，同路線內唯一 `UNIQUE NULLS NOT DISTINCT (route_id, code)`）提供，取代原先由 ID 換算的邏輯。
- **改碼警告與改分路線撞碼**：若站點有未出貨訂單，修改代碼時會觸發兩段式確認；變更路線時若代碼與目標路線的站點代碼重複則會被阻擋。
- **價格與金額**：`products.price` 為 `INTEGER`（新台幣整數元），API 與表單皆驗證為非負整數。
- **訂單歷史快照**：訂單/明細快照 `product_name` / `unit_price` / `subtotal` 等欄位，確保歷史訂單不受後續商品編輯影響。
- **上傳驗證**：上傳驗證於伺服器端（`app/api/upload/route.ts`）：僅 JPG/PNG/WebP（以 magic bytes 檢查），上限 5 MB。

## 部署

可部署於 [Vercel](https://vercel.com/new)。記得於部署環境設定上述環境變數。
