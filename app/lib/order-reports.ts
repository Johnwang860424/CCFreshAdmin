import { sql } from "@/app/lib/db";
import { buildRouteMatrix } from "@/app/domain/route-matrix";
import { summarizeCloseGroups, type CloseGroupSummary } from "@/app/domain/close-groups";

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
                 oi.product_name, p.summary_sort_order AS product_sort, SUM(oi.quantity)::int AS qty
          FROM orders o
          JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
          JOIN order_items oi ON oi.order_id = o.id
          LEFT JOIN products p ON p.id = oi.product_id
          WHERE o.delivery_method = 'pickup'
            AND (o.created_at AT TIME ZONE 'Asia/Taipei')::date BETWEEN ${from} AND ${to}
          GROUP BY ps.id, ps.city, ps.township, ps.route_id, ps.sort_order, oi.product_name, p.summary_sort_order
          ORDER BY ps.city, ps.sort_order, ps.id
        `
      : await sql`
          SELECT ps.id AS spot_id, ps.city, ps.township, ps.route_id, ps.sort_order,
                 oi.product_name, p.summary_sort_order AS product_sort, SUM(oi.quantity)::int AS qty
          FROM orders o
          JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
          JOIN order_items oi ON oi.order_id = o.id
          LEFT JOIN products p ON p.id = oi.product_id
          WHERE o.delivery_method = 'pickup'
            AND (o.created_at AT TIME ZONE 'Asia/Taipei')::date BETWEEN ${from} AND ${to}
            AND ps.route_id IS NOT DISTINCT FROM ${route === "unassigned" ? null : route}
          GROUP BY ps.id, ps.city, ps.township, ps.route_id, ps.sort_order, oi.product_name, p.summary_sort_order
          ORDER BY ps.city, ps.sort_order, ps.id
        `;

  const pivot = buildRouteMatrix(rows);

  let routeName: string | null = null;
  if (typeof route === "number") {
    const nameRows = await sql`SELECT name FROM routes WHERE id = ${route}`;
    routeName = (nameRows[0]?.name as string) ?? null;
  }

  return { route, routeName, from, to, ...pivot };
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

  return summarizeCloseGroups(rows);
}
