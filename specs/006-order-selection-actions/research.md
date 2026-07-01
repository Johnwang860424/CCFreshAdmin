# Research: 訂單勾選出貨與匯出 CSV（跨頁選取）

Phase 0 決策彙整。Technical Context 無殘留 NEEDS CLARIFICATION（FR-011 已於 spec 定案為單一路線視圖）。

## D1 — 跨頁維持勾選的機制

- **Decision**: 使用 antd `Table` 的受控 `rowSelection`：以 `selectedRowKeys` state 保存已勾選訂單 id，並設 `preserveSelectedRowKeys: true`。已選數量取 `selectedRowKeys.length`。
- **Rationale**: `preserveSelectedRowKeys` 讓「不在目前 `dataSource`（分頁或被搜尋篩掉）」的已勾選鍵不被清除，天然滿足 FR-008（跨頁保留）與「篩選不清勾選」的邊界。rowKey 已是 `id`，與後端動作所需一致。
- **Alternatives considered**: 自行以 Set 管理跨頁選取並手動 render checkbox → 重造 antd 既有能力、易錯，否決。

## D2 — 勾選範圍與路線切換（FR-011）

- **Decision**: 勾選限定於「目前選定路線」視圖。監看 `selected`（路線下拉）變動時，將 `selectedRowKeys` 重設為 `[]`。
- **Rationale**: spec 定案 Option A。切路線會重新查詢另一組訂單，保留舊勾選會讓「已選數量」與可見資料不符、且可能對非目前路線訂單誤操作。
- **Alternatives considered**: 跨路線累積（Option B）→ 使用者已否決；且會使匯出混合多路線、後端須放寬範圍，複雜度不必要。

## D3 — 後端動作的資料範圍：id 清單 vs. 既有分組端點

- **Decision**: 新增 `app/api/orders/selection/route.ts`，`POST`＝依 `{ ids }` 匯出、`DELETE`＝依 `{ ids }` 出貨清除。既有 `close/route.ts` 的 `{method, routeId}` 分組端點原封保留（FR-012）。
- **Rationale**: 選取動作的自然鍵是「任意訂單 id 清單」，與分組語意（整條路線／宅配）不同；分開端點各自語意單純、互不影響。
- **Alternatives considered**: 在 `close` 端點的 body 多接一種 `ids` 分支 → 端點語意雙載、判斷分歧，否決。

## D4 — 依 id 清單的資料層查詢與刪除

- **Decision**: `orders.ts` 新增
  - `getOrdersByIds(ids: number[]): Promise<OrderRow[]>`：`WHERE o.id = ANY(${ids})`，`SELECT` 需帶 `pickup_spot_city` / `pickup_spot_township`（供依縣市分頁與取貨地點欄），比照既有 `getOrders`。
  - `deleteOrdersByIds(ids: number[]): Promise<number>`：`DELETE FROM orders WHERE id = ANY(${ids}) RETURNING id`，回傳實際刪除筆數（`order_items` 由 `ON DELETE CASCADE` 一併清除）。
- **Rationale**: `= ANY(${ids})` 為參數化陣列，符合原則 II；`RETURNING` 天然只反映仍存在者，滿足 FR-010（部分已消失不整批失敗、回報實際筆數）。單一 `DELETE` 語句即原子，無需 CTE。
- **Alternatives considered**: 逐筆 `deleteOrder` 迴圈 → 多次往返、非原子，否決。

## D5 — xlsx 組裝去重

- **Decision**: 將 `close/route.ts` 內的 `EXPORT_HEADER`、`orderToRow`、`toSheetName`、依縣市分頁組裝，抽成 `app/lib/order-export.ts` 的 `buildOrdersWorkbook(orders: OrderRow[]): Buffer`（或回傳 `Uint8Array`）。`close` 與 `selection` 兩個 POST 皆呼叫之。
- **Rationale**: 兩處匯出必須產生「相同欄位與依縣市分頁」的檔案（FR-005）；抽共用可避免格式漂移、單一維護點。
- **Alternatives considered**: 複製一份到 selection 路由 → 兩份格式將來易走樣，否決。

## D6 — 匯出檔名與 0 筆 / 部分消失的處理

- **Decision**:
  - 匯出檔名：`safeFilename(\`orders_選取_${taipeiDateStamp()}.xlsx\`)`（沿用既有工具）。
  - 前端在 `selectedRowKeys.length === 0` 時停用兩顆按鈕（FR-007），不送出。
  - 後端仍防禦性驗證 `ids` 非空（`validateOrderIdsBody`）；`getOrdersByIds` 回空陣列時回 400「選取的訂單皆已不存在」；出貨回傳實際刪除筆數供前端提示。
- **Rationale**: 前端停用為主、後端驗證為縱深；訊息以實際處理筆數呈現，符合 FR-010 與 SC-004。
- **Alternatives considered**: 檔名帶路線名 → 選取本就限單一路線，帶名亦可，但「選取」語意已足且更泛用，採簡單版。

## D7 — 出貨後刷新與勾選清空

- **Decision**: 出貨成功後：清空 `selectedRowKeys`、刷新路線清單（`fetchRouteOptions`）與目前路線訂單（`fetchOrders(selected)`）；匯出成功後不清空勾選（可重複匯出，FR-004）。
- **Rationale**: 對齊 FR-009；匯出為唯讀動作，保留勾選讓使用者可接著出貨相同集合。
