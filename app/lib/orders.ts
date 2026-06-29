import { sql } from "@/app/lib/db";
import { calcLineSubtotal, type PromoConfig } from "@/app/lib/promotions";
import type { ValidatedCreateOrder } from "@/app/lib/validation";

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
  /** 自取點鄉鎮（不含縣市）；宅配或取貨點已刪除為 null */
  pickupSpotTownship: string | null;
  /** 現場取貨號碼牌（每取貨點各自遞增；宅配為 null） */
  pickupNumber: number | null;
  shippingAddress: string | null;
  note: string | null;
  total: number;
  /** 來源標籤：網站（預設）/ FB / Line */
  tag: string;
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
    pickupSpotTownship: (r.pickup_spot_township as string) ?? null,
    pickupNumber: (r.pickup_number as number) ?? null,
    shippingAddress: (r.shipping_address as string) ?? null,
    note: (r.note as string) ?? null,
    total: r.total as number,
    tag: (r.tag as string) ?? "網站",
    createdAt: r.created_at as string,
    items: itemsByOrderId.get(r.id as number) ?? [],
  }));
}

/** 取得所有訂單（含明細），按建立時間降冪排列。供結單 CSV 匯出使用。 */
export async function getOrders(): Promise<OrderRow[]> {
  const orderRows = await sql`
    SELECT o.id, o.customer_name, o.phone, o.delivery_method, o.pickup_spot_id,
           o.pickup_number, o.shipping_address, o.note, o.total, o.tag, o.created_at,
           CASE
             WHEN ps.id IS NOT NULL THEN ps.city || ' ' || ps.township
             ELSE NULL
           END AS pickup_spot_label,
           ps.township AS pickup_spot_township
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
               o.pickup_number, o.shipping_address, o.note, o.total, o.tag, o.created_at,
               ps.city || ' ' || ps.township AS pickup_spot_label
        FROM orders o
        JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
        WHERE o.delivery_method = 'pickup'
          AND ps.city = ${city} AND ps.township = ${township}
        ORDER BY o.created_at DESC
      `
    : await sql`
        SELECT o.id, o.customer_name, o.phone, o.delivery_method, o.pickup_spot_id,
               o.pickup_number, o.shipping_address, o.note, o.total, o.tag, o.created_at,
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
           o.pickup_number, o.shipping_address, o.note, o.total, o.tag, o.created_at,
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

/** 後台新增訂單時的業務性錯誤（如商品/取貨點不存在）；route 層據此回 400。 */
export class OrderInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderInputError";
  }
}

/** 自取訂單指派取貨號碼撞唯一鍵時的重試上限。 */
const PICKUP_NUMBER_MAX_RETRY = 5;

interface ProductSnapshot {
  id: number;
  name: string;
  price: number;
  promo_type: string | null;
  promo_config: PromoConfig | null;
}

/**
 * 後台手動建立一筆訂單（含明細）。
 * - 明細的單價/促銷/小計一律以商品「目前」資料快照計算（calcLineSubtotal），不採信前端金額。
 * - 自取訂單依既有約定指派 pickup_number（每取貨點各自遞增），撞唯一鍵時重試；宅配為 NULL。
 * - 以單一 CTE SQL 語句原子寫入 orders 與 order_items（Neon HTTP 無互動式交易）。
 * 回傳新訂單 id。
 */
export async function createOrder(input: ValidatedCreateOrder): Promise<number> {
  const productIds = input.items.map((i) => i.productId);

  const products = (await sql`
    SELECT id, name, price, promo_type, promo_config
    FROM products
    WHERE id = ANY(${productIds})
  `) as ProductSnapshot[];

  const byId = new Map(products.map((p) => [p.id, p]));
  for (const it of input.items) {
    if (!byId.has(it.productId)) {
      throw new OrderInputError("部分商品不存在，請重新選擇");
    }
  }

  if (input.deliveryMethod === "pickup") {
    const spot = await sql`
      SELECT id FROM pickup_spots WHERE id = ${input.pickupSpotId}
    `;
    if (spot.length === 0) {
      throw new OrderInputError("選定的取貨點不存在，請重新選擇");
    }
  }

  // 依商品目前單價＋促銷計算各項小計與總額，並備好寫入用的快照欄位。
  const lineItems = input.items.map((it) => {
    const p = byId.get(it.productId)!;
    const promoType = p.promo_type ?? null;
    const promoConfig = p.promo_config ?? null;
    const promo =
      promoType && promoConfig ? { type: promoType, config: promoConfig } : null;
    return {
      productId: it.productId,
      productName: p.name,
      unitPrice: p.price,
      quantity: it.quantity,
      promoType,
      promoConfig,
      subtotal: calcLineSubtotal(promo, p.price, it.quantity),
    };
  });
  const total = lineItems.reduce((sum, li) => sum + li.subtotal, 0);

  // unnest 用的平行陣列（promo_config 以 text[] 傳入，於 SELECT 時逐筆轉 jsonb）。
  const productIdArr = lineItems.map((li) => li.productId);
  const productNameArr = lineItems.map((li) => li.productName);
  const unitPriceArr = lineItems.map((li) => li.unitPrice);
  const quantityArr = lineItems.map((li) => li.quantity);
  const promoTypeArr = lineItems.map((li) => li.promoType);
  const promoConfigArr = lineItems.map((li) =>
    li.promoConfig === null ? null : JSON.stringify(li.promoConfig),
  );
  const subtotalArr = lineItems.map((li) => li.subtotal);

  const insertOnce = async (pickupNumber: number | null): Promise<number> => {
    const rows = await sql`
      WITH new_order AS (
        INSERT INTO orders (
          customer_name, phone, delivery_method, pickup_spot_id,
          pickup_number, shipping_address, note, total, tag
        )
        VALUES (
          ${input.customerName}, ${input.phone}, ${input.deliveryMethod},
          ${input.pickupSpotId}, ${pickupNumber}, ${input.shippingAddress},
          ${input.note}, ${total}, ${input.tag}
        )
        RETURNING id
      )
      INSERT INTO order_items (
        order_id, product_id, product_name, unit_price, quantity,
        promo_type, promo_config, subtotal
      )
      SELECT new_order.id, t.product_id, t.product_name, t.unit_price, t.quantity,
             t.promo_type, t.promo_config::jsonb, t.subtotal
      FROM new_order, unnest(
        ${productIdArr}::int[],
        ${productNameArr}::text[],
        ${unitPriceArr}::int[],
        ${quantityArr}::int[],
        ${promoTypeArr}::text[],
        ${promoConfigArr}::text[],
        ${subtotalArr}::int[]
      ) AS t(product_id, product_name, unit_price, quantity,
             promo_type, promo_config, subtotal)
      RETURNING order_id
    `;
    return rows[0].order_id as number;
  };

  if (input.deliveryMethod !== "pickup") {
    return insertOnce(null);
  }

  // 自取：取下一個號碼牌；撞唯一鍵 (pickup_spot_id, pickup_number) 時重算重試。
  for (let attempt = 0; attempt < PICKUP_NUMBER_MAX_RETRY; attempt++) {
    const [{ next }] = (await sql`
      SELECT COALESCE(MAX(pickup_number), 0) + 1 AS next
      FROM orders
      WHERE pickup_spot_id = ${input.pickupSpotId}
    `) as { next: number }[];
    try {
      return await insertOnce(next);
    } catch (err) {
      // 23505 = unique_violation：號碼被搶走，重算再試。
      if ((err as { code?: string })?.code === "23505") continue;
      throw err;
    }
  }
  throw new OrderInputError("取貨號碼指派衝突，請稍後再試");
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
