import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";

export interface PickupSpotRow {
  id: number;
  city: string;
  township: string;
  sortOrder: number;
  /** 所屬路線 id；NULL = 未分路線。 */
  routeId: number | null;
  /** 所屬路線名稱（JOIN routes）；未分路線為 null。 */
  routeName: string | null;
}

export const getPickupSpots = unstable_cache(
  async (): Promise<PickupSpotRow[]> => {
    // 排序以「縣市」分群（前台顧客選點順序）；route_id 僅為後台分組屬性，不影響排序。
    const rows = (await sql`
      SELECT ps.id, ps.city, ps.township, ps.sort_order, ps.route_id,
             r.name AS route_name
      FROM pickup_spots ps
      LEFT JOIN routes r ON r.id = ps.route_id
      ORDER BY ps.city, ps.sort_order, ps.id
    `) as {
      id: number;
      city: string;
      township: string;
      sort_order: number;
      route_id: number | null;
      route_name: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      city: r.city,
      township: r.township,
      sortOrder: r.sort_order,
      routeId: r.route_id ?? null,
      routeName: r.route_name ?? null,
    }));
  },
  ["pickup-spots"],
  { tags: ["pickup-spots"] },
);

export async function addPickupSpot(
  city: string,
  township: string,
  routeId: number | null,
) {
  // sort_order 取「該縣市」目前最大值 +1，使新自取點排在所屬縣市群組的最後（前台選點順序）。
  await sql`
    INSERT INTO pickup_spots (city, township, sort_order, route_id)
    VALUES (
      ${city}, ${township},
      (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM pickup_spots WHERE city = ${city}),
      ${routeId}
    )
  `;
}

/** 自取點仍被訂單引用時拋出，呼叫端據此回應「無法刪除」。 */
export class PickupSpotInUseError extends Error {
  constructor() {
    super("此自取點仍有訂單引用，請先結單清除後再刪除");
    this.name = "PickupSpotInUseError";
  }
}

/** 編輯地點時與同縣市既有地點重複（違反 UNIQUE(city, township)）時拋出。 */
export class PickupSpotDuplicateError extends Error {
  constructor() {
    super("同縣市已有相同地點");
    this.name = "PickupSpotDuplicateError";
  }
}

/** 將 23505（UNIQUE(city, township)）轉拋為 PickupSpotDuplicateError，其餘原樣丟出。 */
function rethrowDuplicate(err: unknown): never {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  ) {
    throw new PickupSpotDuplicateError();
  }
  throw err;
}

/**
 * 僅更新地點名稱（township）；所屬縣市（city）與所屬路線（route_id）皆不變。
 * 供「自取點管理」頁使用——該頁所屬路線為唯讀，故不動 route_id。
 * 撞 UNIQUE(city, township)（SQLSTATE 23505）時轉拋 PickupSpotDuplicateError，呼叫端回 409。
 */
export async function updatePickupSpotTownship(id: number, township: string) {
  try {
    await sql`UPDATE pickup_spots SET township = ${township} WHERE id = ${id}`;
  } catch (err) {
    rethrowDuplicate(err);
  }
}

/**
 * 更新地點名稱（township）與所屬路線（route_id；null = 未分路線）；所屬縣市（city）不可變。
 * 供「路線管理」頁修改自取點使用。route_id 僅為後台分組屬性，不影響 sort_order（排序維持以縣市分群）。
 * 撞 UNIQUE(city, township)（SQLSTATE 23505）時轉拋 PickupSpotDuplicateError，呼叫端回 409。
 */
export async function updatePickupSpot(
  id: number,
  township: string,
  routeId: number | null,
) {
  try {
    await sql`
      UPDATE pickup_spots
      SET township = ${township}, route_id = ${routeId}
      WHERE id = ${id}
    `;
  } catch (err) {
    rethrowDuplicate(err);
  }
}

/**
 * 依傳入的 id 順序，原子重寫「單一縣市」內自取點的 sort_order（1-based）。
 * 單一 SQL 語句即達原子性（Neon serverless HTTP 無互動式交易）。
 * `AND p.city = ${city}` 確保只動該縣市的列：不存在或不屬該縣市的 id 自然被略過，
 * 從而在資料層也禁止跨縣市移動。此排序供前台顧客選取貨點使用。
 */
export async function reorderPickupSpots(city: string, ids: number[]) {
  await sql`
    UPDATE pickup_spots AS p
    SET sort_order = v.ord
    FROM (
      SELECT id, ord
      FROM unnest(${ids}::int[]) WITH ORDINALITY AS t(id, ord)
    ) AS v
    WHERE p.id = v.id AND p.city = ${city}
  `;
}

export async function deletePickupSpot(id: number) {
  // 先確認沒有任何訂單引用此自取點，避免違反外鍵或殘留孤兒資料。
  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM orders WHERE pickup_spot_id = ${id}
  `;
  if (count > 0) throw new PickupSpotInUseError();

  await sql`DELETE FROM pickup_spots WHERE id = ${id}`;
}
