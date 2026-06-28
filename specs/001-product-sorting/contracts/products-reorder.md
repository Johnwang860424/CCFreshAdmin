# Contract: 商品排序更新

## PUT /api/products/reorder

依傳入的商品 id 順序，原子重寫所有商品的 `sort_order`。

**Auth**: 同其他 `/api/*`，不經 proxy middleware 守護（專案現況）；屬管理端操作。

### Request

`Content-Type: application/json`

```json
{ "ids": [12, 3, 8, 5] }
```

- `ids`: 商品 id 陣列，**代表期望的由前到後完整順序**。
  - 必填、非空、皆正整數、不得重複。

### Validation（沿用 app/lib/validation.ts 風格，回傳 jsonHandler 的 error 形狀）

- 非陣列 / 空陣列 → 400「排序資料格式錯誤」。
- 含非整數或重複值 → 400「排序資料格式錯誤」。

### Behaviour

- 以單一 SQL（`unnest(ids) WITH ORDINALITY`）將每個 id 的 `sort_order` 設為其在陣列中的位置（1-based）。
- 陣列中已不存在於 DB 的 id 略過，不報錯。
- 成功後 `revalidateCache("products")`。

### Response

`200`

```json
{ "success": true }
```

`400`

```json
{ "error": "排序資料格式錯誤" }
```

`500`

```json
{ "error": "更新商品排序失敗" }
```

### Notes

- 冪等：相同 `ids` 重送結果一致。
- 後寫覆蓋：併發呼叫以最後一次為準（符合 spec 假設）。
