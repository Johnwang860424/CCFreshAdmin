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
- `npm run typecheck` — `tsc --noEmit`
- `npm run test` / `npm run test:watch` — Vitest unit tests (colocated `app/**/*.test.ts`, config in `vitest.config.ts`)
- `npm run check` — lint + typecheck + test (run this before committing)

## Testing & domain layer

Mirrors the customer app (`../CCFresh`): pure business logic lives in **`app/domain/`** — framework/DB-free modules with colocated `*.test.ts` (`order-assembly`, `route-matrix`, `close-groups`, `stock`, `duplicate-orders`). `app/lib/` keeps SQL/IO and thin wrappers that call into domain functions. Order IO is split into `order-queries.ts`, `order-reports.ts`, `order-writes.ts`, and `order-stock.ts`; `app/lib/orders.ts` is a compatibility facade that preserves existing imports. Framework-free lib utilities (`validation.ts`, `promotions.ts`, `csv.ts`, `pickup-code.ts`, `order-export.ts`) also have colocated tests. Validators in `app/lib/validation.ts` return `{ value } | { error: string }` (no `NextResponse`); API routes convert with `badRequest()` from `app/lib/api.ts`. Route-boundary tests cover malformed JSON, Bearer-only cache revalidation, and atomic product writes. No browser e2e framework is configured (admin pages sit behind Google OAuth).

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
- **`proxy.ts` is the middleware** — Next.js 16 renamed `middleware` to `proxy`. It re-exports `auth as proxy` and its `config.matcher` guards every route except `/api/auth` (NextAuth endpoints), `/api/revalidate` (inbound cache-invalidation callback from the customer app, guarded by Bearer `ADMIN_SECRET_TOKEN` instead), static assets, and favicon (thus, other `/api/*` routes are covered by the middleware). The `authorized` callback in `auth.ts` does the optimistic cookie-only check (redirects unauthenticated users to `/login`).
- The `signIn` callback enforces an **email allowlist** (`ALLOWED_EMAILS`). Empty allowlist = nobody can log in (deny-by-default).
- Route group `app/(admin)/` holds all protected pages; `app/(admin)/layout.tsx` calls `auth()` server-side and renders `AdminShell` (client sidebar/header in `app/components/admin-shell.tsx`).

## Data layer

`app/lib/db.ts` exports `sql`, the Neon serverless HTTP client (`neon(process.env.DATABASE_URL!)`). Use it as a tagged template — interpolations are auto-parameterized, so never string-concat user input. Entity modules wrap the queries; the larger order area is capability-split behind the `app/lib/orders.ts` facade.

Schema lives in `db/schema.sql` (run once against Neon); incremental changes are one-off scripts in `db/migrations/` (also applied manually in the Neon SQL Editor). Tables: `categories`, `products`, `product_images`, `routes`, `pickup_spots`, `orders`, `order_items`.

- **Identity is the serial `id`** column (the API route segment is `[id]`, antd table `rowKey="id"`). Data modules return `id`, not a row index.
- **Products have two sort orders**: `sort_order` is the consumer-facing order; `summary_sort_order` (both `INTEGER NOT NULL`; migration `008` backfilled it from `sort_order`) orders the product columns on the 路線訂單統計 screen (matrix queries in `app/lib/order-reports.ts`, its CSV export, and the 統計排序 drag list). The two are maintained independently on 商品管理 via separate drag modes (前台排序 / 統計排序 → `PUT /api/products/reorder` / `reorder-summary`), each atomically rewriting its column 1-based from the dragged id order; `addProduct` gives a new product `MAX+1` in each column, so it appends to both orders.
- `products.price` is `INTEGER` (NT$ whole dollars). API routes coerce/validate (`Number.isInteger`, non-negative); the product form additionally enforces an integer pattern. Data modules pass/return `price` as `number`.
- **Product images are multi-image + ordered**: `product_images` (`product_id` FK `ON DELETE CASCADE`, `image_url`, `sort_order`) is the **single source of truth** for product images — 1–8 per product, ordered by `sort_order` (1-based; `sort_order=1` is the cover). `products` has **no image column** (the old `products.image_url` was dropped in migration `005`). The cover is **derived**, not stored: `getProducts` returns an ordered `images: string[]` and sets `imageUrl` to `images[0]` for convenience of single-image consumers (admin list, customer app). Image writes are atomic single-statement CTEs in `app/lib/products.ts`: `addProduct` inserts product + its images; `updateProduct(...)` atomically updates product fields and replaces the full image set; `getProductImageUrls(id)` reads all URLs (uncached) for Cloudinary cleanup. Count cap 8 is enforced by `validateProductImages` (server) and the product form (hides upload at 8, blocks save at 0).
- **Pickup spots & delivery routes**: each `pickup_spots` row optionally belongs to a `routes` row via nullable `route_id` (NULL = 未分路線 / unassigned). Pickup-spot `sort_order` is **city-scoped** — it drives the customer-facing front end's spot ordering, so it stays grouped by city even though admin order operations (統計 / 篩選 / 結單) group by **route**. Route assignment is edited on the 路線管理 page (`routes/page.tsx`); the 自取點管理 page (`pickup-spots/page.tsx`) shows the route read-only. An order's route is derived live via `orders → pickup_spots → routes` (no snapshot); 宅配 (delivery) and 未分路線 are built-in groups.
- **Pickup-number display code**: `pickup_spots.code` (1–3 uppercase letters, admin-maintained on the 自取點管理 page) is the pickup-number prefix; an order's 取貨號 renders as `code + pickup_number` via `formatPickupCode` in `app/lib/pickup-code.ts` (delivery orders stay numeric-only; the code is joined live into `OrderRow.spotCode`, never snapshotted). Uniqueness is **route-scoped**: `UNIQUE NULLS NOT DISTINCT (route_id, code)` — different routes may reuse the same code (two "A5"s across routes is accepted), and the same key blocks moving a spot into a route that already has its code. Editing the code of a spot that still has orders requires a two-step PUT confirmation (`409 requiresConfirmation` → resend with `confirmCodeChange: true`). 23505 errors are split by constraint name in `app/lib/pickup-spots.ts` (`SpotCodeDuplicateError` vs `PickupSpotDuplicateError`).
- **Product stock (防超賣)**: `products.stock` (nullable `INTEGER`) is a **remaining-sellable counter** — `NULL` = 不限量 (untracked, the default for existing products), `0` = 售完. Admin edits it freely on the 商品管理 page (validated non-negative integer, empty → NULL). Oversell prevention is anchored in the DB: the named constraint `products_stock_nonneg CHECK (stock IS NULL OR stock >= 0)` is the final guard, and stock decrements ride **inside the same single CTE statement** as the order write (`createOrder`'s `dec` CTE, `updateOrderItems`'s net-delta `adj` CTE, `deleteOrder`'s `restock` CTE), so insufficiency aborts the whole statement atomically and concurrent orders serialize on row locks. Friendly zh-TW messages (「商品名」庫存不足（剩餘 N）) come from a pre-check read; SQLSTATE 23514 filtered by that constraint name is the race fallback. Order edits adjust by **net delta per product** (increase deducts, decrease/removal restores); single-order DELETE restores; **shipping paths (`orders/close`, `orders/selection` → `deleteOrdersByGroup`/`deleteOrdersByIds`) deliberately do NOT restore**. The external customer App also checks and decrements stock at order time (same one-CTE-statement pattern, same constraint); after doing so it calls back this app's `POST /api/revalidate` (Bearer `ADMIN_SECRET_TOKEN`, allowlisted tag `products` only, excluded from the proxy matcher) so the admin's cached product list reflects fresh stock — that handler calls `revalidateTag` directly, NOT `revalidateCache`, which would re-notify the frontend in a loop. Because `getProducts` is `unstable_cache`d, order POST/PUT/DELETE handlers call `revalidateCache("products")` after stock-affecting writes.
- `orders` / `order_items` are **originally written by an external customer-facing app** (out of this repo's scope); this admin also creates, **edits (add/remove/re-quantify item lines) and deletes** orders before shipment, exports CSV, and clears (出貨) them by group (`orders/page.tsx`, `order-summary/page.tsx`, `app/api/orders/*`, incl. `app/api/orders/[id]` PUT/DELETE). Orders are mutable working data until 出貨 clears the group (per constitution Principle V); item edits keep each existing line's original snapshot (quantity changes recompute `subtotal` from that snapshot) while newly added lines snapshot the product's current price/promo, and `total` is always the sum of item subtotals. Order/item rows snapshot `product_name` / `unit_price` / `promo_*` / `subtotal` so orders survive later product/pickup-spot edits. FKs: `order_items.product_id` is `ON DELETE SET NULL`; `products.category_id`, `orders.pickup_spot_id` and `pickup_spots.route_id` are `ON DELETE RESTRICT` (a category/pickup-spot/route still referenced cannot be deleted — enforced in the data layer / DB); `order_items → orders` is `ON DELETE CASCADE`.

- **Duplicate-order warning (新增訂單重複確認)**: admin order creation is two-step when a possible duplicate exists — `POST /api/orders` counts same-name orders (name only, phone excluded; via `countSameNameOrdersInGroup` in `app/lib/orders.ts`) in the new order's route group (spot→route; 宅配 and 未分路線 are their own groups, same grouping semantics as the duplicate-order filter) and, unless the body carries `confirmDuplicate: true`, returns `409 { requiresConfirmation: true, duplicateCount, error }` before creating anything; the orders page opens a confirm modal (fixed zh-TW text) and resends with the flag — same two-step pattern as pickup-spot code changes. The check is read-only and the 409 path does not call `revalidateCache`.

`app/lib/cloudinary.ts` handles image upload/delete; uploads go to the `CC` folder. `deleteCloudinaryImage` parses the public ID back out of a secure URL — keep image URLs in Cloudinary's standard `/upload/...` form or that regex breaks.

## API routes & image lifecycle

REST handlers under `app/api/{products,categories,routes,pickup-spots,orders}/` (collection `route.ts` for GET/POST, `[id]/route.ts` for PUT/DELETE; plus sub-routes like `pickup-spots/reorder`, `products/reorder`, `orders/close`, `orders/summary`) and `app/api/upload/` (POST upload, DELETE remove). These `/api/*` routes (except `/api/auth`) are matched by Proxy for an initial auth check. All admin business endpoints use `jsonHandler`, which independently validates the current session and `ALLOWED_EMAILS` before invoking the handler; keep this shared authorization boundary intact rather than relying solely on Proxy. JSON bodies go through `readJson`, which consistently maps malformed input to HTTP 400. The external `/api/revalidate` webhook intentionally does not use `jsonHandler`; it authenticates only with `ADMIN_SECRET_TOKEN`.

Image cleanup is coordinated to avoid orphans (multi-image aware):
- Product update (`PUT`) reads the product's existing image set, atomically saves product fields plus the new set, then best-effort deletes the **diff** (old − new) from Cloudinary — kept images are never touched.
- Product delete fetches all of the product's image urls first, deletes the product (CASCADE clears `product_images`), then deletes every Cloudinary asset.
- Client (`products/page.tsx`) tracks images uploaded during a modal session in `uploadedImageUrlsRef` and deletes them on cancel; removing a still-unsaved session upload also deletes it from Cloudinary immediately, so abandoned uploads don't leak.

Upload validation lives server-side in `app/api/upload/route.ts`: JPG/PNG/WebP only (validated by magic bytes, not just Content-Type), 5 MB max.

## Environment variables

Required: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAILS` (Google OAuth login), `CLOUDINARY_*` (image upload), and `DATABASE_URL` (Neon Postgres connection — pooled string is fine for the serverless HTTP driver). See `.env.local.example`.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/012-duplicate-order-warning/plan.md`
<!-- SPECKIT END -->
