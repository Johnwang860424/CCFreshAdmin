"use client";

// 新增/修改訂單共用的商品明細區塊：試算表式橫向表格——
// 第一列並排產品編號、第二列商品名稱、第三列對應的數量輸入，
// 超出寬度時整張表橫向捲動；數量 0 = 不選購／移除該品項。
// 搜尋框只以 CSS 隱藏不符合的欄（欄保持掛載，表單值/驗證不受過濾影響）。
import { useState, type CSSProperties, type ReactNode } from "react";
import { ConfigProvider, Empty, Form, Input, InputNumber } from "antd";
import { limitDigitsOnly, selectAllOnFocus } from "@/app/lib/dom-utils";

/** 商品明細表格的單欄描述（表單值仍由各視窗的 items 陣列持有）。 */
interface OrderItemsGridRow {
  key: string | number;
  /** 對應表單 items 陣列的索引（Form.Item name path 用）。 */
  index: number;
  /** 產品編號（第一列）；商品已刪除的既有明細沒有編號。 */
  code?: string;
  /** 商品名稱（第二列）。 */
  name: string;
  /** 顯示「售完」標籤。 */
  soldOut?: boolean;
  /** 停用數量輸入（售完且非訂單既有品項）。 */
  inputDisabled?: boolean;
  /** 此欄需要的隱藏 Form.Item（productId / itemId 等，由呼叫端提供）。 */
  hiddenFields?: ReactNode;
}

export function OrderItemsGrid({
  rows,
  loading,
}: {
  rows: OrderItemsGridRow[];
  loading: boolean;
}) {
  // 從外層 Form 監看各欄數量：>0 的欄整欄淡黃底，一眼看出已選購的品項。
  const form = Form.useFormInstance();
  const watchedItems = Form.useWatch<{ quantity?: number }[] | undefined>(
    "items",
    form,
  );
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const matches = (row: OrderItemsGridRow) =>
    query === "" ||
    row.name.toLowerCase().includes(query) ||
    (row.code?.toLowerCase().includes(query) ?? false);
  const visibleRows = rows.filter(matches);
  const visibleCount = visibleRows.length;
  // 白灰交替以「可見欄」的順序計算，過濾後條紋才不會相鄰同色。
  const stripeByKey = new Map(
    visibleRows.map((row, i) => [row.key, i % 2 === 1]),
  );
  const cellStyle = (row: OrderItemsGridRow): CSSProperties => ({
    display: matches(row) ? undefined : "none",
    padding: "2px 1px",
    verticalAlign: "top",
    background:
      Number(watchedItems?.[row.index]?.quantity) > 0
        ? "#fffbe6"
        : stripeByKey.get(row.key)
          ? "#f5f5f5"
          : "#ffffff",
  });
  const headerStyle = (row: OrderItemsGridRow): CSSProperties => ({
    ...cellStyle(row),
    fontWeight: 500,
    textAlign: "left",
  });
  // 欄寬固定為兩個中文字（14px 字 × 2）＋強制換行，避免 table 依整行文字撐開欄寬。
  const clampStyle: CSSProperties = { width: 28, wordBreak: "break-all" };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          marginBottom: 8,
        }}
      >
        <span style={{ fontWeight: 500 }}>商品明細</span>
        <Input.Search
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋商品"
          allowClear
          style={{ flex: "0 1 240px", minWidth: 120 }}
        />
      </div>
      {rows.length === 0 ? (
        !loading && (
          <Empty description="尚無商品" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )
      ) : visibleCount === 0 ? (
        <Empty
          description="無符合的商品"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : null}
      {rows.length > 0 && (
        // 縮小 InputNumber 內距，34px 輸入框內仍容得下三位數。
        <ConfigProvider
          theme={{ components: { InputNumber: { paddingInline: 2 } } }}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {rows.map((row) => (
                    <th key={row.key} style={headerStyle(row)}>
                      {row.hiddenFields}
                      <div style={clampStyle}>{row.code}</div>
                    </th>
                  ))}
                </tr>
                <tr>
                  {rows.map((row) => (
                    <th
                      key={row.key}
                      style={{ ...headerStyle(row), fontWeight: 400 }}
                    >
                      {/* 名稱固定只顯示前兩個字，完整名稱放 hover 提示。 */}
                      <div style={clampStyle} title={row.name}>
                        {row.name.slice(0, 2)}
                        {row.soldOut && (
                          <div style={{ color: "#cf1322" }}>售完</div>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {rows.map((row) => (
                    <td key={row.key} style={cellStyle(row)}>
                      <Form.Item
                        name={["items", row.index, "quantity"]}
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber
                          min={0}
                          precision={0}
                          formatter={(value) =>
                            Number(value) === 0 ? "" : String(value ?? "")
                          }
                          controls={false}
                          disabled={row.inputDisabled}
                          aria-label={`${row.name} 數量`}
                          style={{ width: 34 }}
                          onFocus={selectAllOnFocus}
                          onKeyDown={limitDigitsOnly}
                        />
                      </Form.Item>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </ConfigProvider>
      )}
    </div>
  );
}
