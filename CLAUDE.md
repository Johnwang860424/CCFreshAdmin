# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Commands

- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run start` — serve production build
- `npm run lint` — ESLint (flat config, `eslint.config.mjs`)

No test framework is configured.

## What this is

CC 生鮮 (CC Fresh) admin backend. A Next.js App Router app backed by **Neon Postgres**, queried with raw SQL via `@neondatabase/serverless`. Admins manage delivery routes, pickup spots, product categories and products; product images live in Cloudinary. UI is Traditional Chinese (`zh-TW`).

## Stack & key conventions

- **Next.js 16.2.4 / React 19 / TS strict.** App Router. Path alias `@/*` → repo root (e.g. `@/auth`, `@/app/lib/...`).
- **antd v6** for all UI, wrapped by `@ant-design/nextjs-registry` (`AntdRegistry`) in `app/providers.tsx` for SSR style flushing. Every interactive page is `"use client"`.
  - Gotcha: antd v6 compound statics (`Typography.Title`, `Empty.PRESENTED_IMAGE_SIMPLE`, etc.) are `undefined` in Server Components — any file using them needs `"use client"`.
- **NextAuth v5 (Auth.js, beta)** with Google OAuth, JWT sessions (no DB).

## Auth flow

- `auth.ts` is the single NextAuth config, exporting `handlers / auth / signIn / signOut`.
- `app/api/auth/[...nextauth]/route.ts` re-exports `handlers` as `GET/POST`.
- **`proxy.ts` is the middleware** — Next.js 16 renamed `middleware` to `proxy`. It re-exports `auth as proxy` and its `config.matcher` guards every route except `/api/auth` (NextAuth endpoints), static assets, and favicon (thus, other `/api/*` routes are covered by the middleware). The `authorized` callback in `auth.ts` does the optimistic cookie-only check (redirects unauthenticated users to `/login`).
- The `signIn` callback enforces an **email allowlist** (`ALLOWED_EMAILS`). Empty allowlist = nobody can log in (deny-by-default).
- Route group `app/(admin)/` holds all protected pages; `app/(admin)/layout.tsx` calls `auth()` server-side and renders `AdminShell` (client sidebar/header in `app/components/admin-shell.tsx`).

## Data layer

`app/lib/db.ts` exports `sql`, the Neon serverless HTTP client (`neon(process.env.DATABASE_URL!)`). Use it as a tagged template — interpolations are auto-parameterized, so never string-concat user input. One module per entity wraps the queries: `app/lib/products.ts`, `app/lib/categories.ts`, `app/lib/routes.ts`, `app/lib/pickup-spots.ts`, `app/lib/orders.ts`.

Schema lives in `db/schema.sql` (run once against Neon); incremental changes are one-off scripts in `db/migrations/` (also applied manually in the Neon SQL Editor). Tables: `categories`, `products`, `product_images`, `routes`, `pickup_spots`, `orders`, `order_items`.

- **Identity is the serial `id`** column (the API route segment is `[id]`, antd table `rowKey="id"`). Data modules return `id`, not a row index.
- `products.price` is `INTEGER` (NT$ whole dollars). API routes coerce/validate (`Number.isInteger`, non-negative); the product form additionally enforces an integer pattern. Data modules pass/return `price` as `number`.
- **Product images are multi-image + ordered**: `product_images` (`product_id` FK `ON DELETE CASCADE`, `image_url`, `sort_order`) is the **single source of truth** for product images — 1–8 per product, ordered by `sort_order` (1-based; `sort_order=1` is the cover). `products` has **no image column** (the old `products.image_url` was dropped in migration `005`). The cover is **derived**, not stored: `getProducts` returns an ordered `images: string[]` and sets `imageUrl` to `images[0]` for convenience of single-image consumers (admin list, customer app). Image writes are atomic single-statement CTEs in `app/lib/products.ts`: `addProduct` inserts product + its images; `saveProductImages(id, urls)` 全刪全插 the set; `getProductImageUrls(id)` reads all urls (uncached) for Cloudinary cleanup. Count cap 8 is enforced by `validateProductImages` (server) and the product form (hides upload at 8, blocks save at 0).
- **Pickup spots & delivery routes**: each `pickup_spots` row optionally belongs to a `routes` row via nullable `route_id` (NULL = 未分路線 / unassigned). Pickup-spot `sort_order` is **city-scoped** — it drives the customer-facing front end's spot ordering, so it stays grouped by city even though admin order operations (統計 / 篩選 / 結單) group by **route**. Route assignment is edited on the 路線管理 page (`routes/page.tsx`); the 自取點管理 page (`pickup-spots/page.tsx`) shows the route read-only. An order's route is derived live via `orders → pickup_spots → routes` (no snapshot); 宅配 (delivery) and 未分路線 are built-in groups.
- `orders` / `order_items` are **originally written by an external customer-facing app** (out of this repo's scope); this admin also creates, **edits (add/remove/re-quantify item lines) and deletes** orders before shipment, exports CSV, and clears (出貨) them by group (`orders/page.tsx`, `order-summary/page.tsx`, `app/api/orders/*`, incl. `app/api/orders/[id]` PUT/DELETE). Orders are mutable working data until 出貨 clears the group (per constitution Principle V); item edits keep each existing line's original snapshot (quantity changes recompute `subtotal` from that snapshot) while newly added lines snapshot the product's current price/promo, and `total` is always the sum of item subtotals. Order/item rows snapshot `product_name` / `unit_price` / `promo_*` / `subtotal` so orders survive later product/pickup-spot edits. FKs: `order_items.product_id` is `ON DELETE SET NULL`; `products.category_id`, `orders.pickup_spot_id` and `pickup_spots.route_id` are `ON DELETE RESTRICT` (a category/pickup-spot/route still referenced cannot be deleted — enforced in the data layer / DB); `order_items → orders` is `ON DELETE CASCADE`.

`app/lib/cloudinary.ts` handles image upload/delete; uploads go to the `CC` folder. `deleteCloudinaryImage` parses the public ID back out of a secure URL — keep image URLs in Cloudinary's standard `/upload/...` form or that regex breaks.

## API routes & image lifecycle

REST handlers under `app/api/{products,categories,routes,pickup-spots,orders}/` (collection `route.ts` for GET/POST, `[id]/route.ts` for PUT/DELETE; plus sub-routes like `pickup-spots/reorder`, `products/reorder`, `orders/close`, `orders/summary`) and `app/api/upload/` (POST upload, DELETE remove). Note that while these `/api/*` routes (except `/api/auth`) are matched by the proxy middleware and thus auth-guarded globally, mutating or sensitive endpoints should still validate authorization explicitly (`auth()`) as a defense-in-depth practice.

Image cleanup is coordinated to avoid orphans (multi-image aware):
- Product update (`PUT`) reads the product's existing image set, saves the new set, then deletes the **diff** (old − new) from Cloudinary — kept images are never touched.
- Product delete fetches all of the product's image urls first, deletes the product (CASCADE clears `product_images`), then deletes every Cloudinary asset.
- Client (`products/page.tsx`) tracks images uploaded during a modal session in `uploadedImageUrlsRef` and deletes them on cancel; removing a still-unsaved session upload also deletes it from Cloudinary immediately, so abandoned uploads don't leak.

Upload validation lives server-side in `app/api/upload/route.ts`: JPG/PNG/WebP only (validated by magic bytes, not just Content-Type), 5 MB max.

## Environment variables

Required: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAILS` (Google OAuth login), `CLOUDINARY_*` (image upload), and `DATABASE_URL` (Neon Postgres connection — pooled string is fine for the serverless HTTP driver). See `.env.local.example`.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/006-order-selection-actions/plan.md`
<!-- SPECKIT END -->
