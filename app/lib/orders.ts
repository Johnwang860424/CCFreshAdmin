import { sql } from "@/app/lib/db";
import { calcLineSubtotal, type PromoConfig } from "@/app/lib/promotions";
import type {
  ValidatedCreateOrder,
  ValidatedUpdateOrderItem,
} from "@/app/lib/validation";

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
  /** 自取點縣市（不含鄉鎮）；宅配或取貨點已刪除為 null。供匯出時依縣市分頁使用。 */
  pickupSpotCity: string | null;
  /** 自取點鄉鎮（不含縣市）；宅配或取貨點已刪除為 null */
  pickupSpotTownship: string | null;
  /** 所屬路線 id（經取貨點關聯）；宅配、未分路線或取貨點已刪除為 null */
  routeId: number | null;
  /** 所屬路線名稱；宅配、未分路線或取貨點已刪除為 null */
  routeName: string | null;
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
    pickupSpotCity: (r.pickup_spot_city as string) ?? null,
    pickupSpotTownship: (r.pickup_spot_township as string) ?? null,
    routeId: (r.route_id as number) ?? null,
    routeName: (r.route_name as string) ?? null,
    pickupNumber: (r.pickup_number as number) ?? null,
    shippingAddress: (r.shipping_address as string) ?? null,
    note: (r.note as string) ?? null,
    total: r.total as number,
    tag: (r.tag as string) ?? "網站",
    createdAt: r.created_at as string,
    items: itemsByOrderId.get(r.id as number) ?? [],
  }));
}

/** 取得所有訂單（含明細），按建立順序排列。供結單 CSV 匯出使用。 */
export async function getOrders(): Promise<OrderRow[]> {
  const orderRows = await sql`
    SELECT o.id, o.customer_name, o.phone, o.delivery_method, o.pickup_spot_id,
           o.pickup_number, o.shipping_address, o.note, o.total, o.tag, o.created_at,
           CASE
             WHEN ps.id IS NOT NULL THEN ps.city || ' ' || ps.township
             ELSE NULL
           END AS pickup_spot_label,
           ps.city AS pickup_spot_city,
           ps.township AS pickup_spot_township,
           ps.route_id AS route_id,
           r.name AS route_name
    FROM orders o
    LEFT JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
    LEFT JOIN routes r ON r.id = ps.route_id
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
 * 依路線取得自取訂單（含明細），按建立時間降冪。
 * `routeId` 為路線 id，或 null（未分路線：取貨點 route_id 為 NULL）。
 * 僅含自取訂單——宅配僅有自由文字地址，無取貨點/路線。
 */
export async function getOrdersByRoute(
  routeId: number | null,
): Promise<OrderRow[]> {
  const orderRows = await sql`
    SELECT o.id, o.customer_name, o.phone, o.delivery_method, o.pickup_spot_id,
           o.pickup_number, o.shipping_address, o.note, o.total, o.tag, o.created_at,
           ps.city || ' ' || ps.township AS pickup_spot_label,
           ps.township AS pickup_spot_township,
           ps.route_id AS route_id,
           r.name AS route_name
    FROM orders o
    JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
    LEFT JOIN routes r ON r.id = ps.route_id
    WHERE o.delivery_method = 'pickup'
      AND ps.route_id IS NOT DISTINCT FROM ${routeId}
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
 * 宅配無取貨點/路線，僅有自由文字地址，故獨立成一條查詢路徑。
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

/** 訂單管理篩選下拉資料：有自取訂單的路線、是否有未分路線訂單、是否有宅配訂單。 */
export interface OrderRouteOptions {
  routes: { id: number; name: string }[];
  hasUnassigned: boolean;
  hasDelivery: boolean;
}

/** 取得目前有訂單的路線清單與「未分路線/宅配」是否存在，供訂單管理篩選下拉使用。 */
export async function getOrderRoutes(): Promise<OrderRouteOptions> {
  const routeRows = await sql`
    SELECT DISTINCT r.id, r.name
    FROM orders o
    JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
    JOIN routes r ON r.id = ps.route_id
    WHERE o.delivery_method = 'pickup'
    ORDER BY r.id
  `;

  const [{ has_unassigned, has_delivery }] = (await sql`
    SELECT
      EXISTS(
        SELECT 1 FROM orders o
        LEFT JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
        WHERE o.delivery_method = 'pickup' AND ps.route_id IS NULL
      ) AS has_unassigned,
      EXISTS(
        SELECT 1 FROM orders WHERE delivery_method = 'delivery'
      ) AS has_delivery
  `) as { has_unassigned: boolean; has_delivery: boolean }[];

  return {
    routes: routeRows.map((r) => ({ id: r.id as number, name: r.name as string })),
    hasUnassigned: Boolean(has_unassigned),
    hasDelivery: Boolean(has_delivery),
  };
}

/** 路線訂單統計：以取貨點為列、商品為欄的數量交叉表 */
export interface RouteOrderMatrix {
  /** 查詢回顯：指定路線 id ｜ "unassigned"（未分路線）｜ "all"（全部路線） */
  route: number | "unassigned" | "all";
  /** 指定路線的名稱；未分路線/全部路線為 null */
  routeName: string | null;
  /** 套用之日期區間（YYYY-MM-DD，台北時區，含起訖兩端） */
  from: string;
  to: string;
  /** 欄位：範圍內訂單出現過的所有商品名稱（依名稱排序） */
  products: string[];
  /** 列：每個取貨點一筆，含各商品數量 */
  rows: {
    pickupSpotId: number;
    label: string;
    quantities: Record<string, number>;
  }[];
  /** 每個商品的總量（各取貨點加總，即直欄合計）：商品名稱 → 總數量 */
  productTotals: Record<string, number>;
}

/**
 * 取得路線訂單統計交叉表：縱軸為取貨點（依路線內 sort_order）、橫軸為商品、
 * 內容為各取貨點各商品的訂購數量，並附每個商品的總量。
 * - `route`：指定路線 id（單一路線）、`"unassigned"`（未分路線）、`"all"`（全部路線、跨路線）。
 * - `from`/`to`：日期區間（YYYY-MM-DD，以台北時區比對 created_at，含起訖兩端）。
 * 僅計入自取（pickup）訂單——宅配訂單僅有自由文字地址，無取貨點。
 */
export async function getRouteOrderMatrix(
  route: number | "unassigned" | "all",
  from: string,
  to: string,
): Promise<RouteOrderMatrix> {
  const rows =
    route === "all"
      ? await sql`
          SELECT ps.id AS spot_id, ps.city, ps.township, ps.route_id, ps.sort_order,
                 oi.product_name, p.sort_order AS product_sort, SUM(oi.quantity)::int AS qty
          FROM orders o
          JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
          JOIN order_items oi ON oi.order_id = o.id
          LEFT JOIN products p ON p.id = oi.product_id
          WHERE o.delivery_method = 'pickup'
            AND (o.created_at AT TIME ZONE 'Asia/Taipei')::date BETWEEN ${from} AND ${to}
          GROUP BY ps.id, ps.city, ps.township, ps.route_id, ps.sort_order, oi.product_name, p.sort_order
          ORDER BY ps.city, ps.sort_order, ps.id
        `
      : await sql`
          SELECT ps.id AS spot_id, ps.city, ps.township, ps.route_id, ps.sort_order,
                 oi.product_name, p.sort_order AS product_sort, SUM(oi.quantity)::int AS qty
          FROM orders o
          JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
          JOIN order_items oi ON oi.order_id = o.id
          LEFT JOIN products p ON p.id = oi.product_id
          WHERE o.delivery_method = 'pickup'
            AND (o.created_at AT TIME ZONE 'Asia/Taipei')::date BETWEEN ${from} AND ${to}
            AND ps.route_id IS NOT DISTINCT FROM ${route === "unassigned" ? null : route}
          GROUP BY ps.id, ps.city, ps.township, ps.route_id, ps.sort_order, oi.product_name, p.sort_order
          ORDER BY ps.city, ps.sort_order, ps.id
        `;

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

  let routeName: string | null = null;
  if (typeof route === "number") {
    const nameRows = await sql`SELECT name FROM routes WHERE id = ${route}`;
    routeName = (nameRows[0]?.name as string) ?? null;
  }

  return { route, routeName, from, to, products, rows: resultRows, productTotals };
}

/** 結單分組彙整：宅配為一組，自取則依「路線」（含未分路線）各成一組 */
export interface CloseGroupSummary {
  key: string;
  method: "pickup" | "delivery";
  /** 自取分組所屬路線 id；未分路線為 null。宅配為 null。 */
  routeId: number | null;
  display: string;
  count: number;
}

/**
 * 取得結單分組彙整（各組訂單筆數），供結單視窗列出可結單分組。
 * 自取以路線聚合（同一路線的所有取貨點訂單合為一組），未分路線（route_id 為 NULL）自成一組，宅配自成一組。
 * 直接以 SQL 聚合，不需載入全部訂單明細。
 */
export async function getCloseGroups(): Promise<CloseGroupSummary[]> {
  const rows = await sql`
    SELECT o.delivery_method AS method, ps.route_id AS route_id,
           r.name AS route_name,
           COUNT(*)::int AS count
    FROM orders o
    LEFT JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
    LEFT JOIN routes r ON r.id = ps.route_id
    GROUP BY o.delivery_method, ps.route_id, r.name
  `;

  const groups: CloseGroupSummary[] = rows.map((r) => {
    const method = r.method as string;
    const count = r.count as number;
    if (method === "delivery") {
      return {
        key: "delivery",
        method: "delivery",
        routeId: null,
        display: "宅配",
        count,
      };
    }
    const routeId = (r.route_id as number) ?? null;
    return {
      key: `route:${routeId ?? "∅"}`,
      method: "pickup",
      routeId,
      display: (r.route_name as string) ?? "未分路線",
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

  const insertOnce = async (pickupNumber: number): Promise<number> => {
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

  const spotId = input.deliveryMethod === "pickup" ? input.pickupSpotId : null;

  // 自取或宅配：取下一個號碼牌；撞唯一鍵 (pickup_spot_id, pickup_number) 時重算重試。
  for (let attempt = 0; attempt < PICKUP_NUMBER_MAX_RETRY; attempt++) {
    const [{ next }] = (await (spotId !== null
      ? sql`
          SELECT COALESCE(MAX(pickup_number), 0) + 1 AS next
          FROM orders
          WHERE pickup_spot_id = ${spotId}
        `
      : sql`
          SELECT COALESCE(MAX(pickup_number), 0) + 1 AS next
          FROM orders
          WHERE pickup_spot_id IS NULL
        `)) as { next: number }[];
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

/** 取得單筆訂單（含明細）；不存在回 null。供編輯後回應與內部重載使用。 */
export async function getOrderById(id: number): Promise<OrderRow | null> {
  const orderRows = await sql`
    SELECT o.id, o.customer_name, o.phone, o.delivery_method, o.pickup_spot_id,
           o.pickup_number, o.shipping_address, o.note, o.total, o.tag, o.created_at,
           CASE
             WHEN ps.id IS NOT NULL THEN ps.city || ' ' || ps.township
             ELSE NULL
           END AS pickup_spot_label,
           ps.township AS pickup_spot_township,
           ps.route_id AS route_id,
           r.name AS route_name
    FROM orders o
    LEFT JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
    LEFT JOIN routes r ON r.id = ps.route_id
    WHERE o.id = ${id}
  `;
  if (orderRows.length === 0) return null;

  const itemRows = await sql`
    SELECT id, order_id, product_name, unit_price, quantity, promo_type, promo_config, subtotal
    FROM order_items
    WHERE order_id = ${id}
    ORDER BY id
  `;

  return assembleOrders(orderRows, itemRows)[0];
}

/** 修改訂單品項時，讀取既有明細快照所用的資料形狀（含 product_id 供保留列重寫）。 */
interface ExistingItemSnapshot {
  id: number;
  product_id: number | null;
  product_name: string;
  unit_price: number;
  promo_type: string | null;
  promo_config: PromoConfig | null;
}

/**
 * 修改一筆訂單的商品明細（新增／移除／改數量）並重算總額。
 * - 帶 `id` 的列＝既有明細：保留其單價/促銷/商品快照，僅套用新數量並重算小計（FR-009）。
 * - 帶 `productId` 的列＝新增明細：以商品「目前」單價＋促銷建立快照計算小計（FR-008）。
 * - 未列出的既有明細＝移除。
 * 以單一 CTE 原子替換該訂單的 order_items 並更新 orders.total（Neon HTTP 無互動式交易）。
 * 訂單不存在（並發刪除/出貨）回 null；商品不存在或明細 id 不屬本訂單時拋 OrderInputError。
 */
export async function updateOrderItems(
  id: number,
  items: ValidatedUpdateOrderItem[],
): Promise<OrderRow | null> {
  const orderRows = await sql`SELECT id FROM orders WHERE id = ${id}`;
  if (orderRows.length === 0) return null;

  // 既有明細快照（含 product_id），供帶 id 的保留列重新寫入。
  const existingRows = (await sql`
    SELECT id, product_id, product_name, unit_price, promo_type, promo_config
    FROM order_items
    WHERE order_id = ${id}
  `) as ExistingItemSnapshot[];
  const existingById = new Map(existingRows.map((r) => [r.id, r]));

  // 新增列所需的商品現值快照。
  const newProductIds = items
    .filter((it) => it.productId !== undefined)
    .map((it) => it.productId!);
  const products =
    newProductIds.length > 0
      ? ((await sql`
          SELECT id, name, price, promo_type, promo_config
          FROM products
          WHERE id = ANY(${newProductIds})
        `) as ProductSnapshot[])
      : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const lineItems = items.map((it) => {
    if (it.id !== undefined) {
      const e = existingById.get(it.id);
      if (!e) throw new OrderInputError("明細資料錯誤，請重新載入");
      const promo =
        e.promo_type && e.promo_config
          ? { type: e.promo_type, config: e.promo_config }
          : null;
      return {
        productId: e.product_id,
        productName: e.product_name,
        unitPrice: e.unit_price,
        quantity: it.quantity,
        promoType: e.promo_type,
        promoConfig: e.promo_config,
        subtotal: calcLineSubtotal(promo, e.unit_price, it.quantity),
      };
    }
    const p = productById.get(it.productId!);
    if (!p) throw new OrderInputError("部分商品不存在，請重新選擇");
    const promo =
      p.promo_type && p.promo_config
        ? { type: p.promo_type, config: p.promo_config }
        : null;
    return {
      productId: p.id,
      productName: p.name,
      unitPrice: p.price,
      quantity: it.quantity,
      promoType: p.promo_type,
      promoConfig: p.promo_config,
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

  // 單一語句原子替換：del/ins 為資料變更 CTE（即使未被主查詢參照仍會執行），
  // 主查詢 UPDATE orders 回傳 id；訂單並發消失時回空列。
  const rows = await sql`
    WITH del AS (
      DELETE FROM order_items WHERE order_id = ${id}
    ),
    ins AS (
      INSERT INTO order_items (
        order_id, product_id, product_name, unit_price, quantity,
        promo_type, promo_config, subtotal
      )
      SELECT ${id}, t.product_id, t.product_name, t.unit_price, t.quantity,
             t.promo_type, t.promo_config::jsonb, t.subtotal
      FROM unnest(
        ${productIdArr}::int[],
        ${productNameArr}::text[],
        ${unitPriceArr}::int[],
        ${quantityArr}::int[],
        ${promoTypeArr}::text[],
        ${promoConfigArr}::text[],
        ${subtotalArr}::int[]
      ) AS t(product_id, product_name, unit_price, quantity,
             promo_type, promo_config, subtotal)
    )
    UPDATE orders SET total = ${total} WHERE id = ${id} RETURNING id
  `;
  if (rows.length === 0) return null;

  return getOrderById(id);
}

/** 刪除單筆訂單（order_items 由 ON DELETE CASCADE 自動清除）；回傳是否確有刪到。 */
export async function deleteOrder(id: number): Promise<boolean> {
  const rows = await sql`DELETE FROM orders WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

/**
 * 依「結單分組」刪除訂單（order_items 由 ON DELETE CASCADE 自動清除）。
 * - 宅配：刪除所有 delivery_method='delivery' 的訂單
 * - 自取（指定路線）：刪除該路線所有取貨點的 pickup 訂單
 * - 自取（未分路線 routeId=null）：刪除取貨點 route_id 為 NULL 者，及無取貨點（pickup_spot_id 為 NULL）的 pickup 訂單
 */
export async function deleteOrdersByGroup(
  method: string,
  routeId?: number | null,
) {
  if (method === "delivery") {
    await sql`DELETE FROM orders WHERE delivery_method = 'delivery'`;
    return;
  }

  if (routeId == null) {
    await sql`
      DELETE FROM orders
      WHERE delivery_method = 'pickup'
        AND (
          pickup_spot_id IS NULL
          OR pickup_spot_id IN (
            SELECT id FROM pickup_spots WHERE route_id IS NULL
          )
        )
    `;
  } else {
    await sql`
      DELETE FROM orders
      WHERE delivery_method = 'pickup'
        AND pickup_spot_id IN (
          SELECT id FROM pickup_spots WHERE route_id = ${routeId}
        )
    `;
  }
}
