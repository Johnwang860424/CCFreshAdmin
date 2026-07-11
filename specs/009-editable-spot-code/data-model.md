# Data Model: 站點代碼改為可維護欄位（取貨號碼前綴）

> rev. 2026-07-11：唯一性改為同路線內（`UNIQUE NULLS NOT DISTINCT (route_id, code)`）；回填改為依路線重編。

## pickup_spots（既有表，新增欄位）

| Column | Type | Constraints | 說明 |
|--------|------|-------------|------|
| `code` | TEXT | NOT NULL, `CHECK (code ~ '^[A-Z]{1,3}$')`, `CONSTRAINT pickup_spots_route_id_code_key UNIQUE NULLS NOT DISTINCT (route_id, code)` | 站點代碼（取貨號前綴）。一律大寫儲存；**同路線內唯一**（NULLS NOT DISTINCT 使「未分路線」NULL 群組同樣強制唯一）；跨路線允許同碼。 |

- Migration：`db/migrations/006_add_pickup_spot_code.sql` — `ADD COLUMN`（nullable）→ 依路線重編回填（`row_number() OVER (PARTITION BY route_id ORDER BY id)` 轉 Excel 式字母，每路線自 A 起算，見 research R2）→ `SET NOT NULL` + `CHECK` + 顯式命名 UNIQUE。
- `db/schema.sql` 同步補上欄位定義。
- 站點刪除即釋出代碼（同路線可重用）；**改分路線**時若與目標路線既有代碼相撞，由本唯一鍵擋下（research R8）。
- ⚠️ 回填會改變既有訂單的顯示前綴（放棄零感，使用者裁決）。

## orders（不變）

- `pickup_number` 指派規則、`UNIQUE (pickup_spot_id, pickup_number)` 完全不動。
- 取貨號碼顯示 = `pickup_spots.code`（JOIN 即時取得）+ `pickup_number`；**不快照代碼**。
- 跨路線可能出現相同顯示號碼（兩路線各有 A 站 → 各有 A5）：使用者裁決接受，現場按路線作業。

## TypeScript 型別

### `PickupSpotRow`（app/lib/pickup-spots.ts）

```ts
export interface PickupSpotRow {
  id: number;
  city: string;
  township: string;
  /** 站點代碼（取貨號前綴）：1–3 大寫英文字母，同路線內唯一。 */
  code: string;          // ← 新增
  sortOrder: number;
  routeId: number | null;
  routeName: string | null;
}
```

### `OrderRow`（app/lib/orders.ts）

```ts
/** 所屬站點代碼（JOIN pickup_spots.code 即時取得）；宅配為 null。 */
spotCode: string | null;   // ← 新增
```

## Validation Rules

| 層 | 規則 |
|----|------|
| 前端表單 | 必填；`^[A-Za-z]{1,3}$`；輸入即轉大寫顯示 |
| API（`parseSpotCode`） | trim → `toUpperCase()` → `^[A-Z]{1,3}$`，不符回 400 |
| 資料層 | 23505 依 constraint 名分流：`pickup_spots_route_id_code_key` → `SpotCodeDuplicateError`「同路線已有相同代碼的站點」（409）；涵蓋新增、改碼、改分路線三種寫入路徑 |
| DB | `CHECK` regex + `UNIQUE NULLS NOT DISTINCT (route_id, code)`（最後防線） |

## State / Flow

- **改碼（有訂單）**：PUT(code 變更, 無 confirm) → 409 `{ requiresConfirmation: true, orderCount }` → 前端 Modal 確認 → PUT(`confirmCodeChange: true`) → 200，之後所有該站訂單顯示新前綴。
- **改碼（無訂單）**：PUT 直接 200。
- **新增站點**：POST 必帶 code；同路線重複 → 409。
- **改分路線（路線管理頁）**：目標路線已有同碼站點 → 409「同路線已有相同代碼的站點」；管理員先改其中一站代碼再移動。
