import { sql } from "@/app/lib/db";
import { assembleOrders, type OrderRow } from "@/app/domain/order-assembly";

async function hydrateOrders(
  orderRows: Record<string, unknown>[],
): Promise<OrderRow[]> {
  if (orderRows.length === 0) return [];
  const orderIds = orderRows.map((row) => row.id as number);
  const itemRows = await sql`
    SELECT id, order_id, product_id, product_name, unit_price, quantity, promo_type, promo_config, subtotal
    FROM order_items
    WHERE order_id = ANY(${orderIds})
    ORDER BY id
  `;
  return assembleOrders(orderRows, itemRows);
}
/** 取得所有訂單（含明細），按來源分類排列（FB→Line→網站→其他），供結單 CSV 匯出使用。 */
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
           r.name AS route_name,
           ps.code AS spot_code
    FROM orders o
    LEFT JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
    LEFT JOIN routes r ON r.id = ps.route_id
    ORDER BY
      CASE o.tag
        WHEN 'FB' THEN 1
        WHEN 'Line' THEN 2
        WHEN '網站' THEN 3
        ELSE 4
      END ASC,
      o.id ASC
  `;

  return hydrateOrders(orderRows);
}

/**
 * 依訂單 id 清單取得訂單（含明細），供「選取匯出」使用。
 * 欄位比照 getOrders（含 pickup_spot_city / pickup_spot_township，供依縣市分頁與取貨地點欄）。
 * 只回傳仍存在的訂單——清單中已被刪除/出貨的 id 自然略過（FR-010）。
 */
export async function getOrdersByIds(ids: number[]): Promise<OrderRow[]> {
  if (ids.length === 0) return [];

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
           r.name AS route_name,
           ps.code AS spot_code
    FROM orders o
    LEFT JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
    LEFT JOIN routes r ON r.id = ps.route_id
    WHERE o.id = ANY(${ids})
    ORDER BY
      CASE o.tag
        WHEN 'FB' THEN 1
        WHEN 'Line' THEN 2
        WHEN '網站' THEN 3
        ELSE 4
      END ASC,
      o.id ASC
  `;

  return hydrateOrders(orderRows);
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
           r.name AS route_name,
           ps.code AS spot_code
    FROM orders o
    JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
    LEFT JOIN routes r ON r.id = ps.route_id
    WHERE o.delivery_method = 'pickup'
      AND ps.route_id IS NOT DISTINCT FROM ${routeId}
    ORDER BY
      CASE o.tag
        WHEN 'FB' THEN 1
        WHEN 'Line' THEN 2
        WHEN '網站' THEN 3
        ELSE 4
      END ASC,
      o.created_at DESC
  `;

  return hydrateOrders(orderRows);
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
    ORDER BY
      CASE o.tag
        WHEN 'FB' THEN 1
        WHEN 'Line' THEN 2
        WHEN '網站' THEN 3
        ELSE 4
      END ASC,
      o.created_at DESC
  `;

  return hydrateOrders(orderRows);
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
