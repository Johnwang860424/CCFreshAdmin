# Contract — 取貨號碼格式化（pickup-code）

模組：`app/lib/pickup-code.ts`（純函式，無 React／無 SQL；client 與 server 皆可引用）

## `spotCodeFromId(id: number): string`

Excel 式雙射 26 進位（bijective base-26），大寫輸出。

| 輸入 id | 輸出 |
|---|---|
| 1 | `A` |
| 2 | `B` |
| 26 | `Z` |
| 27 | `AA` |
| 28 | `AB` |
| 52 | `AZ` |
| 53 | `BA` |
| 702 | `ZZ` |
| 703 | `AAA` |

- 前置條件：`id` 為正整數（serial PK，保證成立）；非正整數屬程式錯誤，不需優雅處理。
- 保證：單射（不同 id 必得不同代碼）、確定性（同 id 永遠同代碼）。

## `formatPickupCode(spotId: number | null, pickupNumber: number | null): string | null`

| spotId | pickupNumber | 回傳 | 情境 |
|---|---|---|---|
| 3 | 5 | `"C5"` | 自取訂單（新格式） |
| 27 | 1 | `"AA1"` | 第 27 站 |
| null | 7 | `"7"` | 宅配（維持純數字，D3） |
| 任意 | null | `null` | 防禦；UI 呈現「-」 |

## 消費端（本功能全部顯示點）

| 消費端 | 用法 | 說明 |
|---|---|---|
| `app/(admin)/orders/page.tsx` 取貨號欄 | `formatPickupCode(order.pickupSpotId, order.pickupNumber)`；`null` → `"-"` | Tag 樣式維持既有 |
| `app/(admin)/orders/page.tsx` 搜尋過濾 | 格式化字串與輸入皆轉小寫後 `includes` | `a1`／`A1` 皆命中 `A1` |
| `app/lib/order-export.ts` `orderToRow` 「取貨號」欄 | `formatPickupCode(...) ?? ""` | 經此同時覆蓋 `orders/close` 與 `orders/selection` 兩個匯出端點 |

## 不變式（回歸保護）

- API request/response schema 零變更（`OrderRow` 欄位不增減）。
- DB 寫入路徑零變更（`createOrder`／`updateOrderItems`／外部顧客端 App 不受影響）。
- xlsx 匯出欄位表頭與欄序不變，僅「取貨號」欄的值格式改變。
