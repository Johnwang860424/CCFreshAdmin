// 路線訂單統計交叉表的 pivot 邏輯：純函式、框架/DB 無關。
// SQL 聚合查詢在 app/lib/orders.ts；此處只負責把聚合列轉成「取貨點 × 商品」矩陣。

/** pivot 結果：欄（商品）、列（取貨點）與每商品總量。 */
interface RouteMatrixPivot {
  /** 欄位：範圍內訂單出現過的所有商品名稱（依 products.sort_order，次序同則依名稱 zh-Hant） */
  products: string[];
  /** 列：每個取貨點一筆，含各商品數量（保留輸入列的取貨點順序） */
  rows: {
    pickupSpotId: number;
    label: string;
    quantities: Record<string, number>;
  }[];
  /** 每個商品的總量（各取貨點加總，即直欄合計）：商品名稱 → 總數量 */
  productTotals: Record<string, number>;
}

/**
 * 將 SQL 聚合列（snake_case：spot_id / city / township / product_name / product_sort / qty）
 * pivot 成交叉表。輸入列須已依期望的取貨點順序排序（city, sort_order, id）。
 * 商品欄依 products.sort_order 排序（已刪除商品 product_sort 為 NULL → 排最後）。
 */
export function buildRouteMatrix(
  rows: Record<string, unknown>[],
): RouteMatrixPivot {
  // 以 Map 保留查詢回傳的取貨點順序（已依 city, sort_order, id 排序）。
  const bySpot = new Map<
    number,
    { label: string; quantities: Record<string, number> }
  >();
  const productTotals: Record<string, number> = {};
  // 商品欄位排序鍵：依 products.sort_order（已刪除商品的 product_id 為 NULL → 排最後）。
  const productSortKey = new Map<string, number>();

  for (const r of rows) {
    const spotId = r.spot_id as number;
    const label = `${r.city as string} ${r.township as string}`;
    const product = r.product_name as string;
    const qty = r.qty as number;
    const productSort = (r.product_sort as number) ?? Number.MAX_SAFE_INTEGER;

    if (!productSortKey.has(product)) productSortKey.set(product, productSort);
    if (!bySpot.has(spotId)) bySpot.set(spotId, { label, quantities: {} });
    bySpot.get(spotId)!.quantities[product] = qty;
    productTotals[product] = (productTotals[product] ?? 0) + qty;
  }

  // 商品欄位依 products.sort_order 排序；同序則以名稱（zh-Hant）穩定排序。
  const products = [...productSortKey.keys()].sort((a, b) => {
    const sa = productSortKey.get(a)!;
    const sb = productSortKey.get(b)!;
    return sa !== sb ? sa - sb : a.localeCompare(b, "zh-Hant");
  });

  const resultRows = [...bySpot.entries()].map(
    ([pickupSpotId, { label, quantities }]) => ({
      pickupSpotId,
      label,
      quantities,
    }),
  );

  return { products, rows: resultRows, productTotals };
}
