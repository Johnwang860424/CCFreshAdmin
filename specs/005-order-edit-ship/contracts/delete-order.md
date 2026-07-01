# Contract: DELETE /api/orders/[id] — 刪除單筆訂單

刪除一筆訂單；其 `order_items` 由 `ON DELETE CASCADE` 一併清除。

## Auth

受 `proxy.ts` 全域守衛；handler 內另呼叫 `auth()`（原則 III）。

## Request

無 body。`id` 取自路由段。

## Responses

| 狀態 | 條件 | Body |
|------|------|------|
| 200 | 刪除成功 | `{ "success": true }` |
| 400 | 無效 id 格式 | `{ "error": "無效的 ID 格式" }` |
| 404 | 訂單不存在 | `{ "error": "訂單不存在，可能已被刪除或出貨" }` |
| 500 | 未預期錯誤 | `{ "error": "..." }` |

## 行為要點

- `deleteOrder(id)` 執行 `DELETE FROM orders WHERE id = $id`（參數化）；rowCount=0 → 404。
- 不回收 / 不重編其他訂單的取貨號碼（允許跳號，D6）。
- 前端刪除前顯示二次確認（FR-012）；取消不發送請求。

## Acceptance 對應

FR-011..FR-013；Spec US2 場景 1–3。
