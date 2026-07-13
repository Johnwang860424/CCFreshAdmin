# Research: 新增訂單重複下單警示

**Date**: 2026-07-13 | **Plan**: [plan.md](./plan.md)

Technical Context 無 NEEDS CLARIFICATION；以下為關鍵設計決策與依據。

## D1: 檢查位置——後端兩段式確認，非前端預查

- **Decision**: `POST /api/orders` 內做重複檢查：未帶 `confirmDuplicate: true` 且同分組有同名訂單 → 回 `409 { requiresConfirmation: true, duplicateCount, error }`；前端確認後帶旗標重送。
- **Rationale**:
  - Spec 明定檢查母體為「系統中該分組現存全部訂單」（含外部客購 App 寫入者）。前端 `data` 只載入目前選定視圖，且新訂單的取貨點可屬於**另一條**路線——前端資料既不完整也不對應目標分組，只有 DB 查詢能保證正確。
  - 兩段式 409 是本 repo 既定模式（009 站點改碼：`requiresConfirmation` → `Modal.confirm` → 帶 `confirmCodeChange` 重送），`ApiError` 已保留 `status` 與 `body` 供前端讀取旗標（`app/lib/api-client.ts`），前端處理範式現成。
- **Alternatives considered**:
  - **純前端以已載入資料判定**：母體錯誤（漏外部 App 訂單、漏非當前視圖的目標分組），且新增前未必已選定/載入任何路線視圖。拒絕。
  - **獨立預查端點（GET /api/orders/duplicate-check）**：多一個端點與授權面、每次送出固定兩趟往返；TOCTOU 空窗與兩段式相同，無額外收益。拒絕。
  - **DB 唯一約束硬擋**：spec 明定警示為提示非封鎖（同名不同人合法），不能用約束。拒絕。

## D2: 分組定義與比對查詢

- **Decision**: 新增唯讀函式於 `app/lib/orders.ts`：

  ```
  countSameNameOrdersInGroup({ customerName, deliveryMethod, pickupSpotId }): Promise<number>
  ```

  - **pickup**：目標分組＝所選取貨點的 `route_id`（NULL＝未分路線）。以 `WITH target AS (SELECT route_id FROM pickup_spots WHERE id = ${spotId})` CROSS JOIN，比對 `o.delivery_method='pickup' AND ps.route_id IS NOT DISTINCT FROM target.route_id`。
  - **delivery**：分組＝`o.delivery_method = 'delivery'` 全體（宅配為單一內建分組，無路線）。
  - **姓名**：`o.customer_name = ${name}` 完全相符——輸入端已由 `validateCreateOrderBody` trim；資料庫既有值由各寫入端（後台與外部 App）保證已 trim，故不做 btrim（2026-07-13 裁決，可讓比對直接吃欄位索引）。
- **Rationale**: `IS NOT DISTINCT FROM` 是本 repo 處理「未分路線＝NULL route_id」的既有寫法（`getOrdersByRoute`）；CROSS JOIN target 讓「取貨點不存在」自然回 0（target 空集合），不誤報未分路線分組，錯誤交由 `createOrder` 既有輸入驗證回報。
- **Alternatives considered**:
  - 先另查 spot 的 route_id 再組第二條查詢：兩趟往返、邏輯分散。拒絕。
  - `LOWER()` 或全形正規化：spec/011 裁決明定「僅去頭尾空白後完全相符」，不做模糊比對。拒絕。

## D3: `confirmDuplicate` 旗標的傳遞位置

- **Decision**: POST handler 直接讀 `body.confirmDuplicate === true`；`validateCreateOrderBody` 與 `ValidatedCreateOrder` 介面不動。
- **Rationale**: 與 009 的 `confirmCodeChange` 同款（在 `app/api/pickup-spots/[id]/route.ts` handler 層讀取）；旗標屬「請求流程控制」而非訂單資料，不該進入 `createOrder` 的輸入型別。
- **Alternatives considered**: 併入 ValidatedCreateOrder——污染資料層介面、`createOrder` 用不到。拒絕。

## D4: 前端確認視窗與重送流程

- **Decision**: `handleCreate` 抽出共用送出函式 `submitOrder(values, confirmDuplicate?)`；catch 到 `ApiError` 且 `body.requiresConfirmation === true` 時開 `modal.confirm`（頁面既有 `App.useApp()` 實例）：
  - `content`: 「系統偵測到您可能已有訂單。請確認是否為重複下單」（逐字，FR-003）
  - `okText: "仍要建立"` / `cancelText: "取消"`
  - `onOk`: 帶 `confirmDuplicate: true` 重送，成功後執行與一般建立完全相同的收尾（成功訊息、關窗、重置表單、取貨號視窗、`fetchRouteOptions` 與當前視圖刷新——FR-004）。
  - 取消：僅關閉確認窗；新增訂單 Modal 與已填內容不動（FR-005）。
- **Rationale**: 頁面 139 行已有 `const { modal, message: messageApi } = App.useApp()`，用實例版 `modal.confirm` 吃 App context 主題；共用送出函式避免成功收尾邏輯複製兩份。
- **Alternatives considered**: 靜態 `Modal.confirm`（009 用法）——可行，但頁面已有 modal 實例，沿用實例較一致。自建受控 Modal——多一組 state，confirm 足矣。拒絕。

## D5: 一次警示與 duplicateCount

- **Decision**: COUNT>0 即回一次 409（不論幾筆，FR-007）；回應附 `duplicateCount` 供除錯/未來擴充，跳窗文字固定不用它。
- **Rationale**: spec 假設明載跳窗不列既有訂單明細；count 是查詢的自然副產物，契約帶上無成本（009 也回 `orderCount`）。

## D6: 檢查順序與失敗路徑

- **Decision**: `validateCreateOrderBody` 通過後、`createOrder` 之前檢查。400（欄位驗證）先於 409（重複確認）；庫存不足等 `OrderInputError` 仍由 `createOrder` 拋出、回 400——即確認重複後仍可能因庫存不足失敗，訊息照舊顯示。
- **Rationale**: 無效請求不打 DB；409 語意單純＝「輸入合法，但需要人為確認」。

## D7: TOCTOU 空窗

- **Decision**: 接受檢查與建立之間的競態（兩管理員同時替同一人建單可能都未被警示），不加鎖、不加唯一約束。
- **Rationale**: spec 邊界案例明載「警示屬盡力提示，不保證絕對攔截」；警示本質為提示，錯過的重複事後仍由 011 重複下訂篩選補網。
