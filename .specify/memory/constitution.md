<!--
SYNC IMPACT REPORT
==================
Version change: 1.1.2 → 1.2.0
Bump rationale: Principle V redefined — orders are now mutable (item edit + single delete) until 出貨 clears the group; immutability applies to shipment as the settlement boundary rather than forbidding in-place edits. Snapshot, atomicity, and referential-integrity sub-rules retained/clarified. Enables feature specs/005-order-edit-ship. Materially expanded/redefined principle → MINOR.

Modified principles:
  - V. Order History Is Immutable → V. Orders Are Mutable Until Shipment, Immutable in History

Added sections: none

Removed sections: none

Notes: CLAUDE.md Data layer paragraph updated in the same change — orders/order_items are editable and deletable by the admin before 出貨 via app/api/orders/[id] (PUT/DELETE), no longer "read/export/clear only".
-->

# CC 生鮮 (CC Fresh) Admin Constitution

## Core Principles

### I. Read the Bundled Docs Before Writing Framework Code

This project runs Next.js 16.2.4 / React 19, whose APIs and file conventions
diverge from older releases. Before writing or modifying framework-level code
(routing, middleware/`proxy`, server vs. client boundaries, data fetching), the
relevant guide under `node_modules/next/dist/docs/` MUST be consulted, and
deprecation notices MUST be heeded. Assumptions carried over from prior Next.js
versions are not acceptable justification for a change.

Rationale: The codebase intentionally uses breaking-change APIs (e.g. `proxy.ts`
replacing `middleware`); guessing from memory produces silent, hard-to-detect
breakage.

### II. Parameterized SQL Only (NON-NEGOTIABLE)

All database access goes through the `sql` tagged-template client in
`app/lib/db.ts`. Interpolations MUST flow through the tagged template so they are
auto-parameterized. User-supplied or request-derived values MUST NEVER be
string-concatenated into a query. Each entity's queries live in its own data
module (e.g. `app/lib/products.ts`), and those modules are the only place SQL is
written.

Rationale: Raw SQL over the Neon HTTP driver is the single largest injection
surface; centralizing queries and mandating parameterization keeps that surface
auditable and safe.

### III. Deny-by-Default Authorization

Authentication and the email allowlist (`ALLOWED_EMAILS`) are deny-by-default: an
empty or unmatched allowlist MUST result in no access. Protected pages live under
the `app/(admin)/` route group and are guarded server-side. API routes under
`app/api/` (except `/api/auth` NextAuth endpoints) are covered by the `proxy.ts`
matcher; however, any handler that mutates data or exposes sensitive reads MUST
validate authorization explicitly (`auth()`) rather than solely assuming middleware protection.

Rationale: Relying solely on global middleware configurations is error-prone. Explicit
access control on mutating/sensitive endpoints ensures defense-in-depth and guards
against security regressions if matcher exclusions are modified.

### IV. No Orphaned Images

Cloudinary image lifecycle MUST stay coordinated with database rows. Updates
delete the previous image only when it actually changed; deletes recover the
`imageUrl` before removing the row and then delete the asset; modal sessions track
uploads and clean up abandoned ones on cancel. Image URLs MUST be kept in
Cloudinary's standard `/upload/...` form so `deleteCloudinaryImage`'s public-ID
parser keeps working.

Rationale: Images live in external storage with no foreign key; only disciplined,
ordered cleanup prevents leaked or dangling assets and broken deletes.

### V. Orders Are Mutable Until Shipment, Immutable in History

Orders and order items form the working set for the current group-buy round and
MAY be created, edited (item lines added / removed / re-quantified), and deleted by
an admin **up to the point the group is shipped (出貨)**. Shipment is the
irreversible settlement boundary: 出貨 clears the group's orders, and there is no
post-shipment record to mutate.

Within that pre-shipment window the following MUST hold:

- Snapshotted columns (`product_name`, `unit_price`, `promo_*`, `subtotal`) MUST be
  captured at write time. Existing item lines MUST retain their original snapshot; a
  quantity change recomputes `subtotal` from that same snapshot, and only newly
  added lines snapshot the product's current price/promo. An order's `total` is
  always the sum of its item subtotals.
- All order writes MUST be atomic (single-statement / CTE, per the Neon HTTP
  driver's lack of interactive transactions) so an order's items and total never
  diverge.
- Referential-integrity rules MUST be honored: a category still referenced by
  products, a pickup spot still referenced by orders, or a delivery route still
  referenced by pickup spots cannot be deleted (`ON DELETE RESTRICT`);
  `order_items → orders` is `ON DELETE CASCADE`. These constraints are enforced in
  both the data layer and the database.

Rationale: In this domain orders are cleared every round at 出貨, so a pre-shipment
order is an open working order, not a finalized historical financial record.
Allowing edits and deletes before settlement serves the real workflow (consumers
add or drop items before shipment) without falsifying any retained history —
because nothing is retained past 出貨. The snapshot and atomicity rules keep each
order internally consistent while it is open.

## Technology Constraints

- **Stack**: Next.js 16 App Router, React 19, TypeScript strict, antd v6, NextAuth
  v5 (Auth.js beta) with Google OAuth and JWT sessions, Neon Postgres via
  `@neondatabase/serverless`, Cloudinary for images.
- **Client/server boundary**: Any file using antd v6 compound statics
  (`Typography.Title`, `Empty.PRESENTED_IMAGE_SIMPLE`, etc.) MUST be marked
  `"use client"`; these statics are `undefined` in Server Components.
- **Data types**: `products.price` is an `INTEGER` (NT$ whole dollars). API routes
  MUST validate it as a non-negative integer; data modules pass and return it as a
  `number`.
- **Identity**: The serial `id` column is the canonical identifier (API segment
  `[id]`, antd `rowKey="id"`). Data modules return `id`, never a row index.
- **Upload validation**: Image uploads are validated server-side in
  `app/api/upload/route.ts` — JPG/PNG/WebP only (by magic bytes, not Content-Type),
  5 MB maximum. This validation MUST remain server-side.
- **Localization**: User-facing UI is Traditional Chinese (`zh-TW`).
- **Secrets**: Required environment variables (`AUTH_SECRET`, `AUTH_GOOGLE_ID`,
  `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAILS`, `CLOUDINARY_*`, `DATABASE_URL`) MUST NOT
  be committed; `.env.local.example` documents the contract.

## Development Workflow

- **Linting**: `npm run lint` (ESLint flat config) MUST pass before a change is
  considered complete. There is no test framework configured; correctness is
  verified by lint, type-checking (`npm run build`), and manual review.
- **Schema changes**: Schema lives in `db/schema.sql` and is run against Neon
  manually. Any schema change MUST update `db/schema.sql` and state the migration
  steps in the PR.
- **Review**: Every change MUST be reviewed against these principles. Deviations
  MUST be justified in the PR description, not left implicit.

## Governance

This constitution supersedes ad-hoc practice for the CC Fresh admin codebase. When
guidance here conflicts with habit or training-data assumptions, this document
wins.

- **Amendments** require an edit to this file, a version bump per the policy below,
  and a Sync Impact Report describing what changed and which dependent templates
  were reviewed.
- **Versioning policy** (semantic): MAJOR for backward-incompatible principle
  removals or redefinitions; MINOR for a newly added principle or materially
  expanded guidance; PATCH for clarifications and non-semantic wording fixes.
- **Compliance**: Reviewers MUST verify that changes uphold every applicable
  principle, especially the NON-NEGOTIABLE ones. Project-specific runtime guidance
  for agents and contributors lives in `CLAUDE.md` and MUST stay consistent with
  this constitution.

**Version**: 1.2.0 | **Ratified**: 2026-06-27 | **Last Amended**: 2026-07-01
