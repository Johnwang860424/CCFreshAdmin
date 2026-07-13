# Phase 0 Research: 重複下訂快速篩選

Technical Context 無 NEEDS CLARIFICATION；以下為關鍵技術決策與依據（皆已對照現行程式碼驗證）。

## R1. 判定與篩選放前端（不加後端查詢）

- **Decision**: 重複判定、篩選、排序、標記全部在 `app/(admin)/orders/page.tsx` 的既有列表資料 `data` 上以 `useMemo` 推導；不新增 API、不改資料模組。
- **Rationale**: 訂單頁的資料流本來就是「選路線 → 一次載入該視圖全部訂單 → 前端 `filtered` 過濾」（`page.tsx` 既有 `search` 篩選、總金額卡、全選、勾選出貨/匯出全部吃 `filtered`）。重複判定的母體恰好就是這份 `data`，前端一趟 O(n) 計數即可，路線視圖訂單量為數十～數百筆，無效能疑慮。加後端查詢反而要多維護一條 SQL 與快取一致性。
- **Alternatives considered**:
  - **後端 `GROUP BY ... HAVING COUNT(*) > 1` 查詢＋新端點**：可跨路線偵測，但使用者已裁決範圍限單一路線視圖（方案 A）；跨路線列為未來另案。
  - **DB 加欄位標記重複**：違反「derive, don't store」——重複與否是隨訂單增刪即時變動的衍生事實，落地必然過期。

## R2. 判定鍵的推導規則（2026-07-13 第二次修訂：僅姓名）

- **Decision**: `customerName.trim()` 為鍵（去頭尾空白後完全相符即同一人）；trim 後為空回傳 `null`＝不參與判定（防禦性，姓名必填）。電話完全不比對。
- **Rationale**:
  - 使用者裁決（2026-07-13 第二次修訂）：判定僅以姓名為準。同名不同人的誤標為已接受的取捨，管理員以電話/取貨點自行複核。
  - 僅去頭尾空白、不做內部空白/全形/別字正規化：spec Assumptions 明訂完全相符，不做模糊比對。
- **Alternatives considered**（均為同日先後被取代的舊版規則，記錄決策軌跡）:
  - 初版「電話優先、無電話退回姓名（加 `name:` 前綴）」。
  - 第一次修訂「僅電話（去除所有空白），無電話不參與」。
  - `libphonenumber` 之類的電話正規化——電話已完全退出判定，不再相關。

## R3. 篩選疊加與下游功能的零改動繼承

- **Decision**: 只改 `filtered` 的產生式：`data.filter(o => 既有搜尋條件(o) && (!dupOnly || dupKeys.has(orderKey(o))))`。
- **Rationale**: 現行程式中 `routeTotal`、`stationTotals`、`filteredKeys`（表頭全選）、`dataSource`、「篩選結果共 N 筆」全部以 `filtered` 為單一來源（`page.tsx:412-459`）。改 `filtered` 一處，FR-005 列的所有下游自動一致，這正是既有 `search` 篩選已驗證過的路徑。
- **Alternatives considered**: 另建 `dupFiltered` 平行清單——會造成雙來源，下游要逐一改綁，違反最小變更。

## R4. 相鄰排序演算法（僅開關開啟時）

- **Decision**: `dupOnly` 開啟時，對篩選結果依「鍵首次出現於 `data` 的索引」分組排序：組間按首筆原始位置、組內維持原始相對順序（以 index map 排序，穩定）。
- **Rationale**: FR-006 只要求「同客戶相鄰」；以首見索引為組序保留了使用者熟悉的原始清單脈絡（新單在前/後的既有排序語意），且演算法穩定、切頁不跳動。未開啟時不動任何順序。
- **Alternatives considered**: 依鍵字串字典序排序——順序與原清單無關聯，管理員對照原視圖時失去方向感。

## R5. 列標記的實作（antd v6 Table）

- **Decision**: `Table` 加 `rowClassName={(o) => dupKeys.has(orderKey(o)) ? "dup-order-row" : ""}`，樣式寫在 `app/globals.css`：對 `.dup-order-row > td` 上背景色，並同時指定 hover 態（antd v6 hover 以 td 背景呈現，會蓋掉 tr 層的底色）。
- **Rationale**: `rowClassName` 是 antd Table 的標準列樣式 API，現行 Table（`page.tsx:950`）尚未使用、無衝突；`rowKey="id"`、`rowSelection`、`expandable` 均不受影響。色票選警示黃系（`#fff7e6`，hover `#fff1d6`）——與頁面既有黃色提示框同語彙，且不會與 antd 勾選列的藍色選中態混淆。
- **Alternatives considered**:
  - `onRow` 直接塞 inline style——hover 態與選中態的優先序難處理，class + CSS 較可控。
  - 加一欄「重複」Tag——多佔一欄寬（表格已 `scroll x`），背景色掃視效率更高；若日後要輔助說明可再補 Tooltip，不在本次範圍。

## R6. 開關元件與計數

- **Decision**: antd `Checkbox` 內嵌文字「只看重複下訂（N 筆）」，置於 actions 列搜尋框旁；N＝`data` 中命中 `dupKeys` 的訂單筆數（`useMemo` 與 `dupKeys` 同源）；N=0 時 `disabled`。
- **Rationale**: 計數以訂單筆數計（spec US1-AS2）；放 actions 列與既有「選擇路線／搜尋框」同排，動線一致。Checkbox 比 Switch 省宽、與現有表頭全選 Checkbox 視覺一致。
- **Alternatives considered**: `Switch`＋獨立 `Badge`——佔位大、資訊分離；`Segmented`（全部/重複）——語意過重，本質是布林開關。

## R7. 狀態生命週期

- **Decision**: `dupOnly` 為頁面 state，切換路線時**不**強制重設；`dupKeys`／筆數隨 `data` 重載自動重算；勾選清空沿用既有「切換 `selected` → `setSelectedRowKeys([])`」effect。
- **Rationale**: FR-008 的正確性由 memo 依賴 `data` 保證；開關保留可支援「逐路線巡檢重複單」的連續操作。勾選行為完全不動（既有 FR-011 of 006 規範）。
- **Alternatives considered**: 切路線重設 `dupOnly`——多一條 effect 卻只改變便利性偏好；spec Assumptions 已載明兩者皆不影響正確性，取不動者。
