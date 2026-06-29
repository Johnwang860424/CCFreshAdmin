# Contract: 自取點編輯（僅地點名稱）

## PUT /api/pickup-spots/[id]

更新指定自取點的地點名稱（township）。**city 不可更改**——請求中即使帶 city 也一律忽略。

**Auth**: 同其他 `/api/*`（proxy matcher 守護）；管理端 mutating 操作，沿用 `jsonHandler`。

### Path params

- `id`: 自取點 id，正整數（沿用 `parseId`，無效 → 400「無效的 ID 格式」）。

### Request

`Content-Type: application/json`

```json
{ "township": "信義門市" }
```

- `township`: 地點名稱，必填、trim 後非空。長度上限沿用既有文字欄位風格。
- 任何 `city` 欄位**被忽略**（不會更動所屬縣市）。

### Validation

- `township` 非字串 / trim 後為空 → 400「地點為必填欄位」。
- 超過長度上限 → 400（訊息含上限字數）。

### Behaviour

- `UPDATE pickup_spots SET township = ${township} WHERE id = ${id}`。
- 違反既有 `UNIQUE (city, township)`（同縣市已有相同地點）→ 捕捉 SQLSTATE `23505`，回 `409`。
- 成功後 `revalidateCache("pickup-spots")`。

### Response

`200` → `{ "success": true }`

`400` → `{ "error": "地點為必填欄位" }`

`409` → `{ "error": "同縣市已有相同地點" }`

`500` → `{ "error": "更新自取地點失敗" }`

### Notes

- 不存在的 `id`：更新 0 列，仍回 `200`（與既有刪除/更新風格一致；前端會重新載入）。
- 編輯不影響 `sort_order`（順序維持不變）。
