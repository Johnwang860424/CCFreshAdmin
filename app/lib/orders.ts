import { sql } from "@/app/lib/db";
import type { PromoConfig } from "@/app/lib/promotions";

export interface OrderItemRow {
  id: number;
  orderId: number;
  productName: string;
  unitPrice: number;
  quantity: number;
  /** 下單當下的促銷快照（NULL = 無促銷） */
  promoType: string | null;
  promoConfig: PromoConfig | null;
  /** 折扣後的實付小計，可能不等於 unitPrice × quantity */
  subtotal: number;
}

export interface OrderRow {
  id: number;
  customerName: string;
  phone: string | null;
  deliveryMethod: string;
  /** 自取點 id（宅配為 null） */
  pickupSpotId: number | null;
  /** 自取點顯示名稱（縣市 + 鄉鎮），由 pickup_spots 即時關聯而來；宅配或取貨點已刪除為 null */
  pickupSpotLabel: string | null;
  /** 現場取貨號碼牌（每取貨點各自遞增；宅配為 null） */
  pickupNumber: number | null;
  shippingAddress: string | null;
  note: string | null;
  total: number;
  createdAt: string;
  items: OrderItemRow[];
}

/** 將訂單列與明細列組裝成 OrderRow（明細掛回各自訂單） */
function assembleOrders(
  orderRows: Record<string, unknown>[],
  itemRows: Record<string, unknown>[],
): OrderRow[] {
  const itemsByOrderId = new Map<number, OrderItemRow[]>();
  for (const r of itemRows) {
    const orderId = r.order_id as number;
    const item: OrderItemRow = {
      id: r.id as number,
      orderId,
      productName: r.product_name as string,
      unitPrice: r.unit_price as number,
      quantity: r.quantity as number,
      promoType: (r.promo_type as string) ?? null,
      promoConfig: (r.promo_config as PromoConfig) ?? null,
      subtotal: r.subtotal as number,
    };
    if (!itemsByOrderId.has(orderId)) {
      itemsByOrderId.set(orderId, []);
    }
    itemsByOrderId.get(orderId)!.push(item);
  }

  return orderRows.map((r) => ({
    id: r.id as number,
    customerName: r.customer_name as string,
    phone: (r.phone as string) ?? null,
    deliveryMethod: r.delivery_method as string,
    pickupSpotId: (r.pickup_spot_id as number) ?? null,
    pickupSpotLabel: (r.pickup_spot_label as string) ?? null,
    pickupNumber: (r.pickup_number as number) ?? null,
    shippingAddress: (r.shipping_address as string) ?? null,
    note: (r.note as string) ?? null,
    total: r.total as number,
    createdAt: r.created_at as string,
    items: itemsByOrderId.get(r.id as number) ?? [],
  }));
}

/** 取得所有訂單（含明細），按建立時間降冪排列。供結單 CSV 匯出使用。 */
export async function getOrders(): Promise<OrderRow[]> {
  const orderRows = await sql`
    SELECT o.id, o.customer_name, o.phone, o.delivery_method, o.pickup_spot_id,
           o.pickup_number, o.shipping_address, o.note, o.total, o.created_at,
           CASE
             WHEN ps.id IS NOT NULL THEN ps.city || ' ' || ps.township
             ELSE NULL
           END AS pickup_spot_label
    FROM orders o
    LEFT JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
    ORDER BY o.id ASC
  `;

  const itemRows = await sql`
    SELECT id, order_id, product_name, unit_price, quantity, promo_type, promo_config, subtotal
    FROM order_items
    ORDER BY id
  `;

  return assembleOrders(orderRows, itemRows);
}

/**
 * 依縣市（可再指定鄉鎮）取得自取訂單（含明細），按建立時間降冪。
 * 僅含自取訂單——宅配僅有自由文字地址，無結構化縣市/鄉鎮。
 */
export async function getOrdersByLocation(
  city: string,
  township?: string | null,
): Promise<OrderRow[]> {
  const orderRows = township
    ? await sql`
        SELECT o.id, o.customer_name, o.phone, o.delivery_method, o.pickup_spot_id,
               o.pickup_number, o.shipping_address, o.note, o.total, o.created_at,
               ps.city || ' ' || ps.township AS pickup_spot_label
        FROM orders o
        JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
        WHERE o.delivery_method = 'pickup'
          AND ps.city = ${city} AND ps.township = ${township}
        ORDER BY o.created_at DESC
      `
    : await sql`
        SELECT o.id, o.customer_name, o.phone, o.delivery_method, o.pickup_spot_id,
               o.pickup_number, o.shipping_address, o.note, o.total, o.created_at,
               ps.city || ' ' || ps.township AS pickup_spot_label
        FROM orders o
        JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
        WHERE o.delivery_method = 'pickup' AND ps.city = ${city}
        ORDER BY o.created_at DESC
      `;

  if (orderRows.length === 0) return [];

  const orderIds = orderRows.map((r) => r.id as number);
  const itemRows = await sql`
    SELECT id, order_id, product_name, unit_price, quantity, promo_type, promo_config, subtotal
    FROM order_items
    WHERE order_id = ANY(${orderIds})
    ORDER BY id
  `;

  return assembleOrders(orderRows, itemRows);
}

/**
 * 取得所有宅配訂單（含明細），按建立時間降冪。
 * 宅配無結構化縣市/鄉鎮，僅有自由文字地址，故獨立成一條查詢路徑。
 */
export async function getDeliveryOrders(): Promise<OrderRow[]> {
  const orderRows = await sql`
    SELECT o.id, o.customer_name, o.phone, o.delivery_method, o.pickup_spot_id,
           o.pickup_number, o.shipping_address, o.note, o.total, o.created_at,
           NULL AS pickup_spot_label
    FROM orders o
    WHERE o.delivery_method = 'delivery'
    ORDER BY o.created_at DESC
  `;

  if (orderRows.length === 0) return [];

  const orderIds = orderRows.map((r) => r.id as number);
  const itemRows = await sql`
    SELECT id, order_id, product_name, unit_price, quantity, promo_type, promo_config, subtotal
    FROM order_items
    WHERE order_id = ANY(${orderIds})
    ORDER BY id
  `;

  return assembleOrders(orderRows, itemRows);
}

/** 是否存在宅配訂單（供查詢下拉選單決定是否顯示「宅配」選項） */
export async function hasDeliveryOrders(): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM orders WHERE delivery_method = 'delivery' LIMIT 1
  `;
  return rows.length > 0;
}

/** 縣市與其底下有自取訂單的鄉鎮（供查詢下拉選單使用） */
export interface OrderLocation {
  city: string;
  townships: string[];
}

/** 取得目前有自取訂單的縣市及鄉鎮清單，供搜尋下拉選單使用 */
export async function getOrderLocations(): Promise<OrderLocation[]> {
  const rows = await sql`
    SELECT DISTINCT ps.city, ps.township
    FROM orders o
    JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
    WHERE o.delivery_method = 'pickup'
    ORDER BY ps.city, ps.township
  `;

  const byCity = new Map<string, string[]>();
  for (const r of rows) {
    const city = r.city as string;
    if (!byCity.has(city)) byCity.set(city, []);
    byCity.get(city)!.push(r.township as string);
  }
  return [...byCity.entries()].map(([city, townships]) => ({
    city,
    townships,
  }));
}

/** 縣市訂單統計：以鄉鎮為列、商品為欄的數量交叉表 */
export interface CityOrderMatrix {
  city: string;
  /** 欄位：此縣市訂單出現過的所有商品名稱（依名稱排序） */
  products: string[];
  /** 列：每個鄉鎮一筆，含各商品數量 */
  rows: {
    township: string;
    /** 商品名稱 → 訂購數量（未出現的商品為 0） */
    quantities: Record<string, number>;
  }[];
  /** 每個商品的總量（各鄉鎮加總，即直欄合計）：商品名稱 → 總數量 */
  productTotals: Record<string, number>;
}

/** 取得目前有自取訂單的縣市清單（供查詢下拉選單使用） */
export async function getOrderCities(): Promise<string[]> {
  const rows = await sql`
    SELECT DISTINCT ps.city
    FROM orders o
    JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
    WHERE o.delivery_method = 'pickup'
    ORDER BY ps.city
  `;
  return rows.map((r) => r.city as string);
}

/**
 * 取得指定縣市的訂單交叉表：縱軸為該縣市下有訂單的鄉鎮，橫軸為商品，
 * 表格內容為各鄉鎮各商品的訂購數量，並附每個商品的總量。
 * 僅計入自取（pickup）訂單——宅配訂單僅有自由文字地址，無結構化鄉鎮。
 */
export async function getCityOrderMatrix(
  city: string,
): Promise<CityOrderMatrix> {
  const rows = await sql`
    SELECT ps.township, oi.product_name, SUM(oi.quantity)::int AS qty
    FROM orders o
    JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.delivery_method = 'pickup' AND ps.city = ${city}
    GROUP BY ps.township, oi.product_name
    ORDER BY ps.township
  `;

  const productSet = new Set<string>();
  const byTownship = new Map<string, Record<string, number>>();
  const productTotals: Record<string, number> = {};

  for (const r of rows) {
    const township = r.township as string;
    const product = r.product_name as string;
    const qty = r.qty as number;

    productSet.add(product);
    if (!byTownship.has(township)) byTownship.set(township, {});
    byTownship.get(township)![product] = qty;
    productTotals[product] = (productTotals[product] ?? 0) + qty;
  }

  const products = [...productSet].sort((a, b) =>
    a.localeCompare(b, "zh-Hant"),
  );

  const resultRows = [...byTownship.entries()]
    .map(([township, quantities]) => ({ township, quantities }))
    .sort((a, b) => a.township.localeCompare(b.township, "zh-Hant"));

  return { city, products, rows: resultRows, productTotals };
}

/** 結單分組彙整：宅配為一組，自取則依 pickup_spot_id 各成一組 */
export interface CloseGroupSummary {
  key: string;
  method: "pickup" | "delivery";
  pickupSpotId: number | null;
  display: string;
  count: number;
}

/**
 * 取得結單分組彙整（各組訂單筆數），供結單視窗列出可結單分組。
 * 直接以 SQL 聚合，不需載入全部訂單明細。
 */
export async function getCloseGroups(): Promise<CloseGroupSummary[]> {
  const rows = await sql`
    SELECT o.delivery_method AS method, o.pickup_spot_id,
           CASE
             WHEN ps.id IS NOT NULL THEN ps.city || ' ' || ps.township
             ELSE NULL
           END AS label,
           COUNT(*)::int AS count
    FROM orders o
    LEFT JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
    GROUP BY o.delivery_method, o.pickup_spot_id, label
  `;

  const groups: CloseGroupSummary[] = rows.map((r) => {
    const method = r.method as string;
    const count = r.count as number;
    if (method === "delivery") {
      return {
        key: "delivery",
        method: "delivery",
        pickupSpotId: null,
        display: "宅配",
        count,
      };
    }
    const spotId = (r.pickup_spot_id as number) ?? null;
    return {
      key: `pickup:${spotId ?? "∅"}`,
      method: "pickup",
      pickupSpotId: spotId,
      display: (r.label as string) ?? "（未指定自取點）",
      count,
    };
  });

  // 自取點排前、宅配排後，組內依名稱排序
  return groups.sort((a, b) => {
    if (a.method !== b.method) return a.method === "pickup" ? -1 : 1;
    return a.display.localeCompare(b.display, "zh-Hant");
  });
}

/**
 * 依「結單分組」刪除訂單（order_items 由 ON DELETE CASCADE 自動清除）。
 * - 宅配：刪除所有 delivery_method='delivery' 的訂單
 * - 自取：刪除 delivery_method='pickup' 且 pickup_spot_id 相符（含 NULL）的訂單
 */
export async function deleteOrdersByGroup(
  method: string,
  pickupSpotId?: number | null,
) {
  if (method === "delivery") {
    await sql`DELETE FROM orders WHERE delivery_method = 'delivery'`;
  } else {
    await sql`
      DELETE FROM orders
      WHERE delivery_method = 'pickup'
        AND pickup_spot_id IS NOT DISTINCT FROM ${pickupSpotId ?? null}
    `;
  }
}
