# Implementation Plan: 商品排序功能 (Product Sorting)

**Branch**: `001-product-sorting` | **Date**: 2026-06-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-product-sorting/spec.md`

## Summary

新增 `products.sort_order` 欄位作為全域顯示順序；遷移時以既有 `id` 回填，新商品取 `MAX(sort_order)+1` 排尾。管理端商品表改為可拖拉排序（dnd-kit + antd Table），放開後呼叫新端點 `PUT /api/products/reorder`，以單一原子 SQL 依傳入的 id 順序重寫 `sort_order`。`getProducts` 改 `ORDER BY sort_order`。

## Technical Context

**Language/Version**: TypeScript (strict), React 19, Next.js 16.2.4 (App Router)

**Primary Dependencies**: antd v6、`@neondatabase/serverless`（raw SQL 標籤模板）、新增 `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`（antd v6 官方建議的拖拉方案）

**Storage**: Neon Postgres；`products` 表新增 `sort_order INTEGER NOT NULL`

**Testing**: 無測試框架（專案現況）；以 `quickstart.md` 手動驗證

**Target Platform**: Web（admin 後台，RWD）

**Project Type**: Web app（Next.js App Router 單一專案）

**Performance Goals**: 拖拉放開後 <1s 反映新順序並完成儲存

**Constraints**: Neon serverless HTTP driver 無互動式交易 → 排序儲存須以**單一 SQL 語句**達成原子性；插補須避免 user input 字串拼接（標籤模板自動參數化）

**Scale/Scope**: 商品數量數十～數百筆；單一管理頁面 + 一個新 API 路由 + 一次 DB migration

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` 仍為未填寫的範本，無具體治理原則。改以專案既有慣例（`CLAUDE.md`）作為約束：

- 資料層用 `sql` 標籤模板、自動參數化，不字串拼接使用者輸入 → ✅ 遵守。
- 每實體一個資料模組（`app/lib/products.ts`）包裝查詢 → ✅ 新查詢加於此。
- API route 走 `jsonHandler` + `validateXxxBody` + `revalidateCache` 模式 → ✅ 沿用。
- 互動頁面 `"use client"` + antd v6 → ✅ 沿用。
- 寫入後 `revalidateCache("products")` 使 `unstable_cache` 失效 → ✅ 沿用。

**結論**: PASS（無違規，無需 Complexity Tracking）。

## Project Structure

### Documentation (this feature)

```text
specs/001-product-sorting/
├── plan.md              # 本檔
├── research.md          # Phase 0 決策
├── data-model.md        # Phase 1 資料模型 + migration
├── quickstart.md        # Phase 1 驗證指引
├── contracts/
│   └── products-reorder.md   # PUT /api/products/reorder 合約
└── checklists/
    └── requirements.md  # spec 品質檢核（已產出）
```

### Source Code (repository root)

```text
db/
└── schema.sql                       # 加上 sort_order 欄位（新環境）
                                     # + 既有環境用的一次性 migration（見 data-model.md）

app/
├── lib/
│   └── products.ts                  # ProductRow 加 sortOrder；getProducts ORDER BY sort_order；
│                                    # addProduct 取 MAX+1；新增 reorderProducts(ids)
├── api/
│   └── products/
│       ├── route.ts                 # GET/POST（POST 排尾，沿用 addProduct）
│       └── reorder/
│           └── route.ts             # 新增：PUT 接收 { ids:number[] }，原子重寫順序
└── (admin)/
    └── products/
        └── page.tsx                 # Table 加 dnd-kit 拖拉列；排序模式關閉分頁/搜尋；
                                     #   onDragEnd → PUT /api/products/reorder，失敗回滾
```

**Structure Decision**: 沿用既有單一 Next.js 專案結構，不新增資料夾層級；新檔僅 `app/api/products/reorder/route.ts`。

## Complexity Tracking

無違規，免填。

## Open Questions

1. 排序範圍：本計畫採**全域單一清單**。若需「依分類各自排序」，資料模型與 UI 需調整（sort_order 改為分類內唯一）。
2. 拖拉與分頁/搜尋並存：本計畫在進入排序時改為**顯示完整清單、停用搜尋與分頁**以利跨頁拖拉。是否改採「拖拉僅限當前頁」需確認。
3. 顧客端是否需同步反映此順序，或僅供外部 App 自行讀取？（影響是否需額外對外欄位/通知）
