# Phase 1 Data Model: 自取點編輯與排序

## Entity: pickup_spots（既有，新增一欄）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | `SERIAL PK` | 既有；canonical identity（`rowKey="id"`） |
| `city` | `TEXT NOT NULL` | 既有；縣市，編輯時**唯讀** |
| `township` | `TEXT NOT NULL` | 既有；地點名稱，本功能可編輯 |
| `sort_order` | `INTEGER NOT NULL` | **新增**。語意為「同縣市內」的相對順序，數值小者在前。新環境由 schema 建立；既有環境由 migration 依縣市分群回填 |

- **既有約束**: `UNIQUE (city, township)`（地點唯一性，編輯與新增皆受其約束）。
- **排序語意**: 資料層 `ORDER BY city, sort_order, id`（`id` 為 tie-breaker）。縣市群組的**呈現先後**由前端依 `TAIWAN_LOCATIONS` 索引決定，不由 `sort_order` 表達。
- **唯一性（sort_order）**: 由應用層保證每縣市內連續且唯一（migration 回填、reorder 重寫、新增取該縣市 MAX+1）；**不**加 DB UNIQUE，以容忍重排瞬時狀態並簡化單語句更新。
- **Index**: `CREATE INDEX idx_pickup_spots_city_sort ON pickup_spots(city, sort_order);`

### Validation rules

- **reorder 輸入**: `{ city: string(非空), ids: number[] }`。`ids` 非空、元素皆正整數、不重複。更新時以 `WHERE p.id = v.id AND p.city = ${city}` 限制；不存在或非該縣市的 id 自然略過，不視為錯誤。
- **編輯 township**: `township` trim 後非空；長度上限（沿用既有風格，無既有上限則設合理值如 100 字）。`city` 不接受變更。重複 `(city, township)` 由 DB `23505` → `409`。

## Migration（既有環境，一次性，於 Neon SQL Editor 執行）

`db/migrations/003_add_pickup_spot_sort_order.sql`：

```sql
-- 一次性 migration：為既有環境的 pickup_spots 加上「同縣市內順序」欄 sort_order。
-- 依各縣市既有建立序（id）分群回填，確保上線視覺零變動。
ALTER TABLE pickup_spots ADD COLUMN sort_order INTEGER;

UPDATE pickup_spots AS p
SET sort_order = s.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY city ORDER BY id) AS rn
  FROM pickup_spots
) AS s
WHERE p.id = s.id;                                          -- 各縣市內 1..n，確定且唯一

ALTER TABLE pickup_spots ALTER COLUMN sort_order SET NOT NULL;
CREATE INDEX idx_pickup_spots_city_sort ON pickup_spots(city, sort_order);
```

## schema.sql（新環境）

`pickup_spots` 定義中加入 `sort_order   INTEGER NOT NULL,`，並於檔末（既有 index 區）加：
```sql
CREATE INDEX idx_pickup_spots_city_sort ON pickup_spots(city, sort_order);
```
> 註：`products.sort_order` 屬既有遺漏，未在 `schema.sql` 反映（僅存在於 migration 001）；本功能不追修該既有落差，但 pickup_spots 兩處皆補齊。

## 資料層介面（app/lib/pickup-spots.ts）

- `PickupSpotRow` 增加 `sortOrder: number`（DB `sort_order`）。
- `getPickupSpots` 的 SELECT 加 `sort_order`，`ORDER BY city, sort_order, id`（取代既有 `ORDER BY city, id`）。
- `addPickupSpot(city, township)`：INSERT 加 `sort_order`，值為 `(SELECT COALESCE(MAX(sort_order),0)+1 FROM pickup_spots WHERE city = ${city})`——排在該縣市群組最後（FR-016）。
- **新增** `updatePickupSpotTownship(id: number, township: string): Promise<void>`：`UPDATE pickup_spots SET township = ${township} WHERE id = ${id}`；捕捉 unique violation（`23505`）→ 拋 `PickupSpotDuplicateError`。
- **新增** `reorderPickupSpots(city: string, ids: number[]): Promise<void>`：Decision 3 的單語句 UPDATE（含 `AND p.city = ${city}`）。
- **新增** `class PickupSpotDuplicateError extends Error`（鏡射既有 `PickupSpotInUseError` 模式），route 端對應 `409`。
