# Contract: Orders API — 新增訂單

掛載於既有 `app/api/orders/route.ts`，新增 `POST`。GET 行為不變。

## POST /api/orders

後台手動建立一筆訂單（含明細）。**寫入操作 → handler 內須先 `auth()` 守門。**

### 授權

- 未通過 `auth()`：`401 { "error": "未授權" }`。

### Request Body (application/json)

```jsonc
{
  "customerName": "王小明",          // 必填，非空
  "phone": "0912345678",            // 選填
  "tag": "FB",                      // 選填，網站|FB|Line，未給預設「網站」
  "deliveryMethod": "pickup",       // "pickup" | "delivery"
  "pickupSpotId": 3,                // deliveryMethod=pickup 必填；delivery 時忽略/NULL
  "shippingAddress": "台北市…",      // deliveryMethod=delivery 必填
  "note": "備註文字",                // 選填
  "items": [                         // 必填，至少一項
    { "productId": 12, "quantity": 2 },
    { "productId": 7,  "quantity": 1 }
  ]
}
```

**伺服器忽略** 任何前端送來的價格／小計／總額欄位；金額一律由後端依商品目前單價＋促銷計算。

### 計算與寫入

1. 查 `items` 對應商品的 `name/price/promo_type/promo_config`；缺商品則 400。
2. 重複 `productId` 合併數量。
3. 每項以 `calcLineSubtotal()` 算 `subtotal`，加總為 `total`。
4. 自取：以 `COALESCE(MAX(pickup_number),0)+1`（依 `pickup_spot_id`）指派號碼，撞唯一鍵重試；宅配 `pickup_number=NULL`。
5. 以單一 CTE SQL 原子寫入 `orders` ＋ `order_items`。

### Responses

| 狀態 | Body | 條件 |
|------|------|------|
| 200 | `{ "success": true, "id": 42 }` | 建立成功，回新訂單 id |
| 400 | `{ "error": "<訊息>" }` | 驗證失敗（缺客戶姓名／無商品／數量非正整數／宅配缺地址／自取點不存在／無可用取貨點／商品不存在） |
| 401 | `{ "error": "未授權" }` | 未登入 |
| 500 | `{ "error": "新增訂單失敗" }` | 未預期例外（沿用 `jsonHandler` 錯誤訊息在地化） |

### 驗證錯誤訊息（建議，zh-TW）

- 客戶姓名為必填
- 請至少加入一項商品
- 商品數量需為正整數
- 宅配地址為必填
- 請選擇取貨點 / 目前沒有可用的取貨點，請先建立取貨點
- 來源標籤無效
- 部分商品不存在，請重新選擇

## 連帶影響的既有合約

### GET /api/orders（回傳新增 `tag`）
所有 `OrderRow` 新增 `tag: string`（值為 `網站|FB|Line`）。`orders.ts` 各查詢 `SELECT` 補上 `o.tag`。

### POST /api/orders/close（CSV 匯出新增「來源」欄）
匯出 header 加入「來源」，每列加入 `order.tag`。欄位位置建議置於「客戶姓名」之後或「備註」之前（實作時定案）。
