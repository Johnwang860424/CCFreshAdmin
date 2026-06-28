# Quickstart / 驗證指引: 商品排序功能

## Prerequisites

- 已套用 migration（見 [data-model.md](./data-model.md)）：`products.sort_order` 已存在且既有商品已回填。
- 已安裝拖拉相依：`npm i @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`。
- `npm run dev`，以允許清單內的 Google 帳號登入後台。

## Scenario 1 — 遷移後初始順序正確（FR-004 / SC-002）

1. 套用 migration 後開啟 `/products`。
2. 預期：商品順序與套用前一致（依 id），無遺漏、無重複。

## Scenario 2 — 拖拉排序並持久化（US1 / FR-001、FR-002 / SC-001）

1. 在商品列表拖動某商品至新位置放開。
2. 預期：列表立即顯示新順序；背景送出 `PUT /api/products/reorder`。
3. 重新整理頁面。預期：新順序維持。
4. （可選）以另一瀏覽器/無痕重新登入，順序一致。

## Scenario 3 — 新商品排尾（US2 / FR-003 / SC-003）

1. 點「新增商品」建立一筆。
2. 預期：新商品出現在列表最末，且可被拖拉。

## Scenario 4 — 儲存失敗回滾（FR-007、FR-008 / SC-004）

1. （模擬）暫時讓 `/api/products/reorder` 失敗（例如停用 DB 或改回傳 500）。
2. 拖拉一商品放開。
3. 預期：出現錯誤提示；列表回復到拖拉前順序，無半套狀態。

## Scenario 5 — 邊界

- 空清單 / 單筆：拖拉不報錯。
- 跨分頁：排序模式顯示完整清單，可將商品從末頁拖到首位。

## References

- API 合約：[contracts/products-reorder.md](./contracts/products-reorder.md)
- 資料模型與 migration：[data-model.md](./data-model.md)
