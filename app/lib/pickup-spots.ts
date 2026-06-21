import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";

export interface PickupSpotRow {
  id: number;
  city: string;
  township: string;
}

export const getPickupSpots = unstable_cache(
  async (): Promise<PickupSpotRow[]> => {
    const rows = (await sql`
      SELECT id, city, township
      FROM pickup_spots
      ORDER BY city, id
    `) as PickupSpotRow[];
    return rows.map((r) => ({
      id: r.id,
      city: r.city,
      township: r.township,
    }));
  },
  ["pickup-spots"],
  { tags: ["pickup-spots"] },
);

export async function addPickupSpot(city: string, township: string) {
  await sql`
    INSERT INTO pickup_spots (city, township)
    VALUES (${city}, ${township})
  `;
}

/** 自取點仍被訂單引用時拋出，呼叫端據此回應「無法刪除」。 */
export class PickupSpotInUseError extends Error {
  constructor() {
    super("此自取點仍有訂單引用，請先結單清除後再刪除");
    this.name = "PickupSpotInUseError";
  }
}

export async function deletePickupSpot(id: number) {
  // 先確認沒有任何訂單引用此自取點，避免違反外鍵或殘留孤兒資料。
  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM orders WHERE pickup_spot_id = ${id}
  `;
  if (count > 0) throw new PickupSpotInUseError();

  await sql`DELETE FROM pickup_spots WHERE id = ${id}`;
}
