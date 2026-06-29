# Quickstart / 驗證指南: 自取點編輯與排序

## 前置

1. 套用 migration（既有環境）：於 Neon SQL Editor 執行 `db/migrations/003_add_pickup_spot_sort_order.sql`。
   - 驗證：`SELECT city, township, sort_order FROM pickup_spots ORDER BY city, sort_order;` 每個縣市內 `sort_order` 為 1..n、無重複、無 NULL。
2. 啟動 dev server：`npm run dev`，登入後前往 `/pickup-spots`。
3. 完成程式碼後務必通過：`npm run lint` 與 `npm run build`（型別檢查）。

## 場景 A — 同縣市內拖拉排序（US1 / FR-005~015）

1. 一般模式下，畫面為既有單一表格（搜尋、分頁、操作欄）。先在搜尋框輸入字串並翻到第 2 頁。
2. 點「排序」→ 預期：搜尋框被清空、分頁關閉、清單以**縣市分組**顯示完整列表、操作欄（刪除鈕）消失、每列左側出現拖拉把手。
3. 在某縣市群組內，按住把手把某地點拖到同群組另一位置放開 → 預期：畫面立即顯示新順序（樂觀更新）。
4. 重新整理頁面 → 預期：該縣市仍維持新順序（已持久化）。
5. 嘗試把某地點拖向**別的縣市群組** → 預期：無法跨群組移動，地點留在原縣市。
6. 點「完成排序」→ 預期：回到一般模式，恢復搜尋、分頁、操作欄。

**儲存失敗還原**：暫時讓 `PUT /api/pickup-spots/reorder` 失敗（例如離線/改錯網址），拖放一次 → 預期：出現錯誤提示且該縣市順序回復到拖拉前。

## 場景 B — 編輯地點名稱（US2 / FR-001~004）

1. 一般模式對某自取點點「編輯」→ 開啟 Modal，縣市欄為**唯讀**，地點欄可改。
2. 改地點名稱後儲存 → 預期：列表更新為新名稱，縣市不變。
3. 把地點改成**同縣市已存在**的名稱 → 預期：提示「同縣市已有相同地點」（409），未變更。
4. 把地點清空後儲存 → 預期：必填驗證阻擋。

## 場景 C — 新增排在縣市群組最後（US3 / FR-016）

1. 記下某縣市目前最後一個地點。
2. 在該縣市新增一個自取點 → 進入排序模式檢視該縣市群組 → 預期：新自取點在該群組**最末**位置。

## 參考

- 資料模型與 migration：[data-model.md](./data-model.md)
- API 合約：[contracts/pickup-spots-reorder.md](./contracts/pickup-spots-reorder.md)、[contracts/pickup-spots-edit.md](./contracts/pickup-spots-edit.md)
- 互動原型：商品排序頁 `app/(admin)/products/page.tsx`（DragHandle / SortableRow / handleDragEnd / 排序模式切換）
