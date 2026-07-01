# Data Model: 訂單勾選出貨與匯出 CSV（跨頁選取）

**無 schema 變更、無新資料表欄位。** 本功能新增的是畫面選取狀態與依 id 清單作用的資料層函式。沿用既有 `orders` / `order_items` 與 `app/lib/orders.ts` 的 `OrderRow` / `OrderItemRow`。

## 既有實體（沿用，不變）

- **`orders`** / **`OrderRow`**：訂單主檔。此功能以其 `id` 作為勾選、匯出、出貨的鍵；匯出需 `pickupSpotCity` / `pickupSpotTownship`（依縣市分頁與取貨地點欄）、`shippingAddress`（宅配地點）、`pickupNumber` / `customerName` / `total` / `phone` / `note`（匯出欄位）。
- **`order_items`** / **`OrderItemRow`**：訂單明細。匯出時以 `productName * quantity` 串接為「購買清單」欄；出貨刪除訂單時由 `ON DELETE CASCADE` 一併清除。

## 新增：畫面選取狀態（僅存在於 client，不落地）

- **Selection Set（勾選集合）**
  - 表示：目前選定路線視圖中被勾選的訂單 `id` 集合。
  - 載體：`orders/page.tsx` 的 `selectedRowKeys: React.Key[]` state（antd `Table` 受控 `rowSelection`，`preserveSelectedRowKeys: true`）。
  - 生命週期／狀態轉移：
    - 勾選／取消單列或表頭全選 → 增減對應 id。
    - 切換「選擇路線」下拉（`selected` 變動）→ 重設為 `[]`（FR-011）。
    - 表格翻頁、輸入「於結果內篩選」→ **不變**（跨頁與篩選皆保留，FR-008 / 邊界）。
    - 出貨成功 → 重設為 `[]`（FR-009）。
    - 匯出成功 → 維持不變（可重複匯出）。
  - 衍生：已選數量 = `selectedRowKeys.length`（涵蓋所有分頁，FR-002）。

## 新增：資料層函式（`app/lib/orders.ts`）

- **`getOrdersByIds(ids: number[]): Promise<OrderRow[]>`**
  - 查詢：`... FROM orders o LEFT JOIN pickup_spots ps ... LEFT JOIN routes r ... WHERE o.id = ANY(${ids})`，欄位比照 `getOrders`（含 `pickup_spot_city` / `pickup_spot_township`）；明細以 `WHERE order_id = ANY(orderIds)` 取回後 `assembleOrders`。
  - 語意：只回傳仍存在的訂單（部分 id 已被刪/出貨則自然略過，FR-010）。回傳順序不影響匯出（匯出內部另依縣市分頁與既有列序）。

- **`deleteOrdersByIds(ids: number[]): Promise<number>`**
  - 查詢：`DELETE FROM orders WHERE id = ANY(${ids}) RETURNING id`；回傳 `rows.length`＝實際刪除筆數。
  - 語意：單一語句原子；`order_items` 由 `ON DELETE CASCADE` 清除。

## 新增：驗證（`app/lib/validation.ts`）

- **`validateOrderIdsBody(body): { value: number[] } | { error }`**
  - 規則：`ids` 為陣列、非空、每元素正整數、去重（比照 `validateReorderBody`）。
  - 失敗回 400「選取資料格式錯誤」。

## 新增：xlsx 組裝（`app/lib/order-export.ts`）

- **`buildOrdersWorkbook(orders: OrderRow[]): Uint8Array`（或 Buffer）**
  - 由 `close/route.ts` 現行邏輯抽出：`EXPORT_HEADER`、`orderToRow`、`toSheetName`、依縣市（宅配歸「宅配」、無縣市歸「未分縣市」）分工作表、縣市名稱 `zh-Hant` 穩定排序。
  - 供 `close`（分組匯出）與 `selection`（選取匯出）共用，確保格式一致（FR-005）。

## 驗證規則對應需求

| 需求 | 落點 |
|------|------|
| FR-002 已選數量涵蓋所有分頁 | `selectedRowKeys.length`（preserveSelectedRowKeys） |
| FR-005 匯出格式沿用依縣市分頁 | `buildOrdersWorkbook` 共用 |
| FR-007 0 筆不送出 | 前端按鈕 disabled + 後端 `validateOrderIdsBody` |
| FR-008 跨頁保留 | `preserveSelectedRowKeys: true` |
| FR-010 部分消失不整批失敗 | `getOrdersByIds` / `deleteOrdersByIds` 以 `ANY` + `RETURNING` 天然只作用於仍存在者 |
| FR-011 切路線清空 | 監看 `selected` 變動重設 `selectedRowKeys` |
