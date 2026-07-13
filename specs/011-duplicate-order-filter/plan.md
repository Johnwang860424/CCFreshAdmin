# Implementation Plan: 重複下訂快速篩選

**Branch**: `main`（實作時建議開 `feature/duplicate-order-filter`） | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-duplicate-order-filter/spec.md`

## Summary

純前端功能，**只改 `app/(admin)/orders/page.tsx` 一個元件檔**，零 DB／零 API 變更。訂單頁本已把整條路線視圖的訂單全載入 `data` 再於前端過濾，故：以 `data` 為母體推導每筆訂單的判定鍵（客戶姓名去頭尾空白；電話不比對——2026-07-13 第二次修訂），`useMemo` 算出「出現 >1 筆的鍵集合」`dupKeys`；搜尋框旁加「只看重複下訂（N 筆）」開關，開啟時在既有 `filtered` 條件上 AND 疊加 `dupKeys.has(orderKey(o))` 並將結果依鍵分組相鄰排序——總金額卡、站點統計、表頭全選、勾選出貨/匯出全部吃 `filtered`，自動生效。「客戶」欄 render：命中 `dupKeys` 的訂單於姓名後附橙色「重複」Tag，不受開關與搜尋影響。

## Technical Context

**Language/Version**: TypeScript（strict）/ Next.js 16.2.4 / React 19

**Primary Dependencies**: antd v6（`Checkbox`／`Table rowClassName`，頁面已是 `"use client"`）

**Storage**: 無變更——不新增欄位、不新增查詢；判定鍵為畫面即時推導值，不落地

**Testing**: 無測試框架（憲法）；`npm run lint`、`npm run build` + quickstart.md 手動驗證

**Target Platform**: 既有部署（Vercel／Node server），管理後台瀏覽器

**Performance Goals**: `dupKeys` 為 O(n) 單趟 Map 計數（n＝路線視圖訂單數，數十～數百筆），`useMemo` 依 `data` 快取；排序僅在開關開啟時對篩選結果執行，無感知延遲

**Constraints**: UI zh-TW；重複判定母體＝`data`（整個路線視圖），不受搜尋字串影響（FR-002）；既有下游功能（總金額卡、全選、勾選出貨/匯出）不得改動其資料來源——它們已統一吃 `filtered`，本功能只改 `filtered` 的產生

**Scale/Scope**: 異動 ≈ 1 個頁面檔（約 +40 行）＋ globals.css 一小段；無新檔案

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | 評估 | 結果 |
|---|-----------|------|------|
| I | Read the Bundled Docs | 不觸及 routing／proxy／server-client 邊界／data fetching；純 client 元件內計算與渲染 | PASS |
| II | Parameterized SQL Only | 零 SQL 變更 | PASS |
| III | Deny-by-Default Authorization | 無新端點；沿用既有頁面與既有 GET 資料流 | PASS |
| IV | No Orphaned Images | 不涉及圖片 | PASS |
| V | Orders Mutable Until Shipment | 唯讀呈現，不改任何訂單寫入路徑；篩選後的勾選出貨仍走既有端點 | PASS |
| — | Technology Constraints | zh-TW 文案；`orders/page.tsx` 已是 `"use client"`（antd 相容）；identity 仍以 `id`（`rowKey="id"` 不變，判定鍵僅供分組不當 identity 用） | PASS |

**Post-Phase-1 re-check**: 全數 PASS（無新端點、無 schema 變更、無快取影響；`rowClassName` 為 antd Table 既有 API）。

## Project Structure

### Documentation (this feature)

```text
specs/011-duplicate-order-filter/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── duplicate-filter-ui.md   # UI 行為契約（判定鍵/開關/計數/排序/列標記）
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
app/
└── (admin)/orders/page.tsx   # 修改（唯一異動檔）：
                               #  - orderKey(o)：判定鍵推導（姓名去頭尾空白；電話不比對）
                               #  - dupKeys = useMemo(依 data 計數 >1 的鍵集合)
                               #  - dupOnly state ＋ 搜尋框旁 Checkbox「只看重複下訂（N 筆）」
                               #  - filtered：既有搜尋條件 AND (!dupOnly || dupKeys.has(key))
                               #    ＋ dupOnly 時依鍵分組相鄰排序（組間依組首筆原順序、組內維持原順序）
                               #  - 「客戶」欄 render：dupKeys 命中 → 姓名後附 <Tag color="orange">重複</Tag>
                               #  - 切換路線時 setDupOnly 不強制重設（dupKeys 隨 data 重算，筆數自然更新）
```

**Structure Decision**: 沿用「列表資料一次載入、前端過濾」的既有頁面架構，把重複判定做成 `data` 的衍生 memo，讓所有下游（統計卡、全選、勾選出貨/匯出、筆數）零改動地繼承篩選結果——這是 spec FR-005 的達成方式，也符合使用者「derive, don't store」偏好（判定鍵不落地、不入 DB）。

## Complexity Tracking

無憲法違規，無需填寫。

## Design Notes（關鍵決策摘要，詳見 research.md）

- **D1 判定鍵**（2026-07-13 第二次修訂：僅姓名）：`orderKey(o)` = `customerName.trim()`；為空回傳 `null`＝不參與判定（防禦性，姓名必填）。電話完全不比對（初版「電話優先退回姓名」與第一次修訂「僅電話」均已依使用者裁決取代）。
- **D2 母體**：`dupKeys` 以 `data`（目前路線視圖全部訂單）計，`useMemo([data])`；不依賴 `search`／`dupOnly`，故搜尋縮小結果不影響標記與判定（FR-002、US2-AS2）。
- **D3 篩選疊加**：`filtered = data.filter(既有搜尋條件 && (!dupOnly || dupKeys.has(orderKey(o))))`；下游全部吃 `filtered`，FR-005 自動成立，無需逐一改動。
- **D4 相鄰排序**：僅 `dupOnly` 開啟時排序——以「該鍵首次出現在 `data` 的索引」為組序、組內維持原相對順序（穩定、不跳動；未開啟時完全維持既有排序，FR-006）。
- **D5 開關 UI**：antd `Checkbox`（非 Switch——與表頭全選一致的視覺語彙，且可內嵌文字「只看重複下訂（N 筆）」）；N＝`data` 中命中 `dupKeys` 的訂單筆數；未選路線時整個列表區本就不渲染，開關隨 actions 列存在但無資料可作用（FR-009 由既有「請先選擇路線」空狀態涵蓋）；`data` 無重複時 checkbox `disabled`＋顯示 0 筆。
- **D6 重複標示**（2026-07-13 依使用者裁決由「列背景色」改為「客戶欄標籤」）：「客戶」欄 `render` 在命中 `dupKeys` 時於姓名後附 `<Tag color="orange">重複</Tag>`；不用 `rowClassName`、不動 `globals.css`。橙色與「來源」欄既有 Tag 色系（default/blue/green）及取貨號 geekblue 區分。
- **D7 切換路線**：`data` 重載 → `dupKeys`／筆數／標記全部隨 memo 重算（FR-008）；勾選清空沿用既有 `useEffect`（切換 `selected` 已 `setSelectedRowKeys([])`），`dupOnly` 狀態保留（對新視圖立即套用，正確性不受影響——spec Assumptions 已載明）。
- **D8 匯出/出貨語意不變**：勾選動作仍以 `selectedRowKeys`（id）呼叫既有 `/api/orders/selection`；本功能只影響「哪些列可見、全選涵蓋誰」，端點與參數零改動。
