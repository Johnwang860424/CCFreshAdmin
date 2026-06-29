# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Commands

- `npm run dev` — start dev server (http://localhost:3000)
- `npm run build` — production build
- `npm run start` — serve production build
- `npm run lint` — ESLint (flat config, `eslint.config.mjs`)

No test framework is configured.

## What this is

CC 生鮮 (CC Fresh) admin backend. A Next.js App Router app backed by **Neon Postgres**, queried with raw SQL via `@neondatabase/serverless`. Admins manage pickup spots and products; product images live in Cloudinary. UI is Traditional Chinese (`zh-TW`).

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

`app/lib/db.ts` exports `sql`, the Neon serverless HTTP client (`neon(process.env.DATABASE_URL!)`). Use it as a tagged template — interpolations are auto-parameterized, so never string-concat user input. One module per entity wraps the queries: `app/lib/products.ts`, `app/lib/pickup-spots.ts`.

Schema lives in `db/schema.sql` (run once against Neon). Tables: `products`, `pickup_spots`, `orders`, `order_items`.

- **Identity is the serial `id`** column (the API route segment is `[id]`, antd table `rowKey="id"`). Data modules return `id`, not a row index.
- `products.price` is `INTEGER` (NT$ whole dollars). API routes coerce/validate (`Number.isInteger`, non-negative); the product form additionally enforces an integer pattern. Data modules pass/return `price` as `number`.
- `orders` / `order_items` are **written by an external customer-facing app** (out of this repo's scope); this admin only reads, exports (結單 CSV), and clears them (`orders/page.tsx`, `order-summary/page.tsx`, `app/api/orders/*`). Order/item rows snapshot `product_name` / `unit_price` / `promo_*` / `subtotal` so historical orders survive later product/pickup-spot edits. FKs: `order_items.product_id` is `ON DELETE SET NULL`; `products.category_id` and `orders.pickup_spot_id` are `ON DELETE RESTRICT` (a category/pickup-spot still referenced cannot be deleted — enforced in the data layer / DB); `order_items → orders` is `ON DELETE CASCADE`.

`app/lib/cloudinary.ts` handles image upload/delete; uploads go to the `CC` folder. `deleteCloudinaryImage` parses the public ID back out of a secure URL — keep image URLs in Cloudinary's standard `/upload/...` form or that regex breaks.

## API routes & image lifecycle

REST handlers under `app/api/{products,pickup-spots}/` (collection `route.ts` for GET/POST, `[rowIndex]/route.ts` for PUT/DELETE) and `app/api/upload/` (POST upload, DELETE remove). Note that while these `/api/*` routes (except `/api/auth`) are matched by the proxy middleware and thus auth-guarded globally, mutating or sensitive endpoints should still validate authorization explicitly (`auth()`) as a defense-in-depth practice.

Image cleanup is coordinated to avoid orphans:
- Product update (`PUT`) deletes the old Cloudinary image only if it changed.
- Product delete fetches the row first to recover its `imageUrl`, then deletes the Cloudinary image after the sheet row.
- Client (`products/page.tsx`) tracks images uploaded during a modal session in `uploadedImageUrlsRef` and deletes them on cancel, so abandoned uploads don't leak.

Upload validation lives server-side in `app/api/upload/route.ts`: JPG/PNG/WebP only (validated by magic bytes, not just Content-Type), 5 MB max.

## Environment variables

Required: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAILS` (Google OAuth login), `CLOUDINARY_*` (image upload), and `DATABASE_URL` (Neon Postgres connection — pooled string is fine for the serverless HTTP driver). See `.env.local.example`.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
