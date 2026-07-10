# Data Model — 取貨號碼英數格式（008-pickup-code-format）

**零 schema 變更、零 migration。** 本功能只新增「衍生值」，不新增任何儲存欄位。

## 既有欄位（不動）

| Table.Column | Type | 規則（維持現狀） |
|---|---|---|
| `orders.pickup_spot_id` | INTEGER FK → pickup_spots, `ON DELETE RESTRICT`, nullable | 宅配為 NULL；自取永遠指向存在的站點（RESTRICT 保證） |
| `orders.pickup_number` | INTEGER NOT NULL | 站點內（宅配為 NULL-spot 作用域）自 1 遞增，`MAX+1` + 23505 重試；`UNIQUE NULLS NOT DISTINCT (pickup_spot_id, pickup_number)` |

## 衍生值（新，只存在於程式碼）

| 名稱 | 定義 | 性質 |
|---|---|---|
| 站點代碼 `spotCode` | `spotCodeFromId(pickup_spot_id)` — Excel 式雙射 26 進位：1→A…26→Z、27→AA、28→AB… | 純函式衍生；因 id 不可變且唯一 → 代碼永久穩定、站點間互異 |
| 取貨號碼（顯示） `pickupCode` | 自取：`spotCode + pickup_number`（如 `A5`）；宅配（spotId NULL）：`String(pickup_number)`；`pickup_number` 為 null（防禦）：`null` → UI 顯示「-」 | 顯示/匯出/搜尋三處共用同一函式 |

## TypeScript 介面

- `OrderRow`（`app/lib/orders.ts`）：**欄位不變**（已含 `pickupSpotId: number | null`、`pickupNumber: number | null`）；僅註解更新。
- 新模組 `app/lib/pickup-code.ts`：
  - `spotCodeFromId(id: number): string` — id ≥ 1；輸出大寫 A–Z 串。
  - `formatPickupCode(spotId: number | null, pickupNumber: number | null): string | null`

## 驗證規則

無新增輸入欄位 → 無新增驗證。唯一性由既有唯一鍵（數字部分）與 id 唯一性（字母部分）共同保證。

## 狀態轉移

無變更：出貨清除刪除分組訂單 → 該作用域 `MAX+1` 自然歸 1（FR-010，既有行為）。
