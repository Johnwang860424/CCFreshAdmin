import { describe, expect, it } from "vitest";
import { buildRouteMatrix } from "./route-matrix";

const row = (
  spotId: number,
  township: string,
  product: string,
  qty: number,
  productSort: number | null,
) => ({
  spot_id: spotId,
  city: "台中市",
  township,
  product_name: product,
  product_sort: productSort,
  qty,
});

describe("buildRouteMatrix", () => {
  it("pivot 成「取貨點 × 商品」矩陣並加總直欄合計", () => {
    const pivot = buildRouteMatrix([
      row(1, "西區", "芒果", 3, 2),
      row(1, "西區", "鳳梨", 1, 1),
      row(2, "北區", "芒果", 2, 2),
    ]);

    expect(pivot.rows).toEqual([
      { pickupSpotId: 1, label: "台中市 西區", quantities: { 芒果: 3, 鳳梨: 1 } },
      { pickupSpotId: 2, label: "台中市 北區", quantities: { 芒果: 2 } },
    ]);
    expect(pivot.productTotals).toEqual({ 芒果: 5, 鳳梨: 1 });
  });

  it("商品欄依 products.sort_order 排序；已刪除商品（sort 為 null）排最後", () => {
    const pivot = buildRouteMatrix([
      row(1, "西區", "已刪商品", 1, null),
      row(1, "西區", "芒果", 1, 2),
      row(1, "西區", "鳳梨", 1, 1),
    ]);
    expect(pivot.products).toEqual(["鳳梨", "芒果", "已刪商品"]);
  });

  it("保留輸入列的取貨點順序（已依 city, sort_order, id 排序）", () => {
    const pivot = buildRouteMatrix([
      row(9, "後排點", "芒果", 1, 1),
      row(3, "前排點", "芒果", 1, 1),
    ]);
    expect(pivot.rows.map((r) => r.pickupSpotId)).toEqual([9, 3]);
  });

  it("空輸入回傳空矩陣", () => {
    expect(buildRouteMatrix([])).toEqual({
      products: [],
      rows: [],
      productTotals: {},
    });
  });
});
