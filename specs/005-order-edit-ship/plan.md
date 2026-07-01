# Implementation Plan: 訂單修改、刪除與出貨/CSV 分離

**Branch**: `main`（本檔以 `specs/005-order-edit-ship` 為依據） | **Date**: 2026-07-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-order-edit-ship/spec.md`

## Summary

在訂單管理頁面新增三項能力，皆在「出貨前」的訂單工作視窗內操作，不新增任何資料表欄位：

1. **修改訂單品項**：新增／移除明細、調整數量；新增明細採商品「目前」單價＋促銷快照，既有明細保留原始快照、僅改數量時以原快照重算小計；儲存後重算訂單總額。以單一 CTE 語句原子替換該訂單的 `order_items` 並更新 `orders.total`。
2. **刪除單筆訂單**：`DELETE /api/orders/[id]`，`order_items` 由既有 `ON DELETE CASCADE` 一併清除。
3. **出貨 / CSV 分離**：原「結單」（POST 匯出 CSV → DELETE 清除）拆為兩個獨立動作——「出貨」只清除分組（沿用既有 `deleteOrdersByGroup`，不再下載 CSV）、「匯出 CSV」只下載不清資料且可重複匯出。UI 上「結單」按鈕更名「出貨」，另加獨立「匯出 CSV」按鈕。

## Technical Context

**Language/Version**: TypeScript 5（strict）／React 19／Next.js 16.2.4（App Router）

**Primary Dependencies**: antd v6、NextAuth v5（Auth.js beta）、`@neondatabase/serverless`（Neon HTTP tagged-template）、既有 `app/lib/promotions.ts`（`calcLineSubtotal`）、`app/lib/csv.ts`（`buildCsv` 等）

**Storage**: Neon Postgres。**本功能不改 schema**（沿用 `orders` / `order_items`）。無 migration。

**Testing**: 無測試框架；以 `npm run lint` + `npm run build`（型別檢查）+ 手動驗證（quickstart.md）為準。

**Target Platform**: Web（管理後台，桌機／行動瀏覽器），使用者介面 zh-TW。

**Project Type**: Next.js App Router 單一 web 專案（`app/` 下前端頁面 + `app/api/` 路由 + `app/lib/` 資料層）。

**Performance Goals**: 一般後台互動；單筆訂單編輯／刪除為單一 HTTP 往返，無高併發需求。

**Constraints**: Neon HTTP 無互動式交易 → 原子性以「單一 CTE 語句」達成（沿用 `createOrder` 既有手法）；金額一律後端計算，不採信前端；SQL 一律走 tagged template 參數化。

**Scale/Scope**: 每檔團購數十～數百筆訂單；影響檔案約 3～4 個（`orders.ts`、`orders/[id]/route.ts` 新增、`orders/route.ts` 或 `orders/close` 調整、`orders/page.tsx`），加 `validation.ts` 一支新驗證。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | 原則 | 判定 | 說明 |
|---|------|------|------|
| I | Read Bundled Docs Before Framework Code | ✅ Pass | 動到 route handler 與 client page，屬既有模式（jsonHandler、`[id]` 動態段、`"use client"`），無新框架行為；如遇 App Router 疑點先查 `node_modules/next/dist/docs/`。 |
| II | Parameterized SQL Only（NON-NEGOTIABLE） | ✅ Pass | 新增的 update／delete／replace 查詢全部寫在 `app/lib/orders.ts`，以 `sql` tagged template 參數化（含 `unnest(...)` 陣列參數，比照 `createOrder`）。 |
| III | Deny-by-Default Authorization | ✅ Pass | 新 `PUT`/`DELETE /api/orders/[id]` 受 `proxy.ts` 全域守衛；並於這些「變更資料」端點顯式呼叫 `auth()` 作縱深防禦。 |
| IV | No Orphaned Images | ✅ N/A | 訂單／明細不含 Cloudinary 影像，無影像生命週期。 |
| V | Order History Is Immutable | ⚠️ **Deviation — 需修憲** | 本功能會就地編輯／刪除既有 `orders`/`order_items` 列，與現行原則 V 字面（「rows MUST NOT be edited or deleted in place」）衝突。屬使用者明示、且限「出貨前工作視窗」的產品決策。詳見 Complexity Tracking 與 research.md 決策 D5，實作 PR 需連帶修訂憲章原則 V（MINOR）。 |

**Gate 結果**：除原則 V 為「已具明確理由的刻意偏離（deviation）」外全部通過。此偏離已在 Complexity Tracking 記載理由與較簡替代方案之取捨，並要求於實作時同步修訂憲章，故不視為未justified 的 gate failure。

## Project Structure

### Documentation (this feature)

```text
specs/005-order-edit-ship/
├── plan.md              # 本檔
├── research.md          # Phase 0：決策與理由
├── data-model.md        # Phase 1：實體、驗證、狀態
├── quickstart.md        # Phase 1：手動驗證流程
├── contracts/           # Phase 1：API 合約
│   ├── put-order.md
│   ├── delete-order.md
│   ├── export-csv.md
│   └── ship-group.md
├── checklists/
│   └── requirements.md  # /speckit-specify 產出
└── tasks.md             # /speckit-tasks 產出（本命令不建立）
```

### Source Code (repository root)

```text
app/
├── (admin)/orders/page.tsx          # 修改：列操作（編輯／刪除）、編輯 Modal、出貨/匯出CSV 按鈕拆分
├── api/orders/
│   ├── route.ts                     # 不變（清單/建立）
│   ├── [id]/route.ts                # 新增：PUT（改品項）、DELETE（刪單筆）
│   └── close/route.ts               # 調整：GET 分組不變；出貨/匯出改由下列端點承擔
│       # 出貨（清除，不下載）與 匯出CSV（下載，不清除）兩個獨立動作
│       # 實作選項見 research.md D4（沿用 /close 的 POST/DELETE 語意重整，或新增子路由）
└── lib/
    ├── orders.ts                    # 新增：getOrderById、updateOrderItems、deleteOrder；沿用 deleteOrdersByGroup
    └── validation.ts                # 新增：validateUpdateOrderItemsBody
```

**Structure Decision**: 沿用既有 Next.js App Router 單一專案結構。實體 CRUD 走 `app/api/orders/[id]/route.ts`（比照其他實體的 `[id]` 動態段），分組層級的出貨／匯出續留 `app/api/orders/close/*`（或其子路由）。所有 SQL 集中於 `app/lib/orders.ts`。

## Complexity Tracking

> 僅記載 Constitution Check 中需被justified 的偏離。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 原則 V（Order History Is Immutable）：就地編輯／刪除既有 `orders`/`order_items` | 使用者明示需求：消費者在**出貨前**追加／減少品項須反映在同一筆訂單，否則被迫併入下一檔；並需能刪除作廢訂單。訂單於每檔「出貨」即清除，出貨前屬「開放中的工作訂單」而非已完成的歷史財務紀錄。 | 「只新增、不修改」的替代方案（追加另開一筆新訂單）被否決：會產生同客戶多筆零散訂單、取貨號碼牌重複／混亂、CSV 與統計難以彙整，且無法真正表達「同一筆訂單被追加」的語意。故採就地編輯，並將原則 V 重新定義為「**出貨前可修改，出貨為清帳邊界**」（實作 PR 連帶修憲，MINOR）。 |
