# Contract: 自取點排序更新（單一縣市）

## PUT /api/pickup-spots/reorder

依傳入某縣市的自取點 id 順序，原子重寫「該縣市」的 `sort_order`。

**Auth**: 同其他 `/api/*`（proxy matcher 守護）；屬管理端 mutating 操作，沿用 `jsonHandler`。

### Request

`Content-Type: application/json`

```json
{ "city": "臺北市", "ids": [12, 3, 8, 5] }
```

- `city`: 縣市名稱字串，必填、非空。
- `ids`: 該縣市自取點 id 陣列，**代表期望的由前到後完整順序**。必填、非空、皆正整數、不得重複。

### Validation（沿用 app/lib/validation.ts 風格，回傳 jsonHandler 的 error 形狀）

- `city` 非字串 / 空字串 → 400「排序資料格式錯誤」。
- `ids` 非陣列 / 空陣列 / 含非整數 / 含重複 → 400「排序資料格式錯誤」。

### Behaviour

- 以單一 SQL（`unnest(ids) WITH ORDINALITY` + `WHERE p.id = v.id AND p.city = ${city}`）把該縣市每個 id 的 `sort_order` 設為其在陣列中的位置（1-based）。
- 陣列中已不存在 DB、或不屬於該縣市的 id 自然略過，不報錯（保障「禁止跨縣市」）。
- 成功後 `revalidateCache("pickup-spots")`。

### Response

`200` → `{ "success": true }`

`400` → `{ "error": "排序資料格式錯誤" }`

`500` → `{ "error": "更新自取點排序失敗" }`

### Notes

- 冪等：相同 `{city, ids}` 重送結果一致。
- 後寫覆蓋：併發呼叫以最後一次為準（符合 spec 低併發假設）。
- 範圍限定：只影響 `city` 指定的縣市群組，其他縣市的順序不受影響。
