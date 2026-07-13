# Data Model: 重複下訂快速篩選

**零資料庫變更**。本功能不新增資料表、欄位、索引或查詢；以下皆為前端執行期的衍生結構（僅存在於 `app/(admin)/orders/page.tsx` 元件內）。

## 既有實體（唯讀取用）

### Order（`OrderRow` → 頁面 `Order`，來自既有 GET 資料流）

| 取用欄位 | 型別 | 用途 |
|----------|------|------|
| `id` | `number` | 列 identity（`rowKey`、勾選 key）——不變 |
| `customerName` | `string` | 判定鍵的唯一來源（去頭尾空白） |
| `phone` | `string \| null` | 僅顯示用（不參與判定） |
| `total` | `number` | 篩選後統計卡加總（既有邏輯，自動繼承） |

其餘欄位（取貨點、路線、金額明細等）均不受影響。

## 衍生結構（執行期，不落地）

### 判定鍵 `orderKey(order): string | null`（2026-07-13 第二次修訂：僅姓名）

```
nameKey = order.customerName 去除頭尾空白
orderKey = nameKey 非空 ? nameKey : null（防禦性；姓名必填，理論上不為空）
```

- **電話不比對**：判定只看姓名；同名即併組，電話異同無影響。
- **不可當 identity**：僅供分組；列 identity 仍是 `id`。

### 重複鍵集合 `dupKeys: Set<string>`

- **推導**：對 `data`（目前路線視圖全部訂單）以 `orderKey` 計數，取「出現次數 > 1」的鍵。
- **依賴**：`useMemo([data])`——與 `search`、`dupOnly` 無關（FR-002：判定母體不受搜尋影響）。
- **生命週期**：`data` 重載（切換路線、重新整理、刪單/出貨後刷新）即重算（FR-008）。

### 重複筆數 `dupCount: number`

- `data` 中 `dupKeys.has(orderKey(o))` 為真的訂單筆數（以訂單計，非客戶數；spec US1-AS2）。
- 顯示於開關文字「只看重複下訂（N 筆）」；N=0 時開關 disabled。

### 篩選開關 `dupOnly: boolean`（React state）

- 預設 `false`；切換路線不重設（正確性由 memo 重算保證）。

### 篩選結果 `filtered: Order[]`（既有變數，改產生式）

```
filtered = data
  .filter(既有搜尋條件 AND (!dupOnly OR dupKeys.has(orderKey(o))))
  |> dupOnly 時：依「鍵首見於 data 的索引」穩定分組排序（組內維持原順序）
```

- 下游零改動繼承：`routeTotal`、`stationTotals`、表頭全選 `filteredKeys`、Table `dataSource`、「篩選結果共 N 筆」（FR-005）。

## 狀態轉移

| 事件 | dupKeys / dupCount | dupOnly | 列標記 |
|------|--------------------|---------|--------|
| 選定/切換路線（`data` 重載） | 重算 | 保留 | 隨重算更新 |
| 輸入搜尋字串 | 不變（母體是 `data`） | 不變 | 不變（仍標記） |
| 開/關篩選開關 | 不變 | 翻轉 | 不變 |
| 刪單、出貨、重新載入後刷新 | 重算 | 保留 | 隨重算更新（剩單筆者脫離標記） |
