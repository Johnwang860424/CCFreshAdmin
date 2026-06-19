import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";

export interface PickupSpotRow {
  id: number;
  city: string;
  township: string;
}

export const getPickupSpots = unstable_cache(
  async (): Promise<PickupSpotRow[]> => {
    const rows = await sql`
      SELECT id, city, township
      FROM pickup_spots
      ORDER BY city, id
    `;
    return rows.map((r) => ({
      id: r.id as number,
      city: r.city as string,
      township: r.township as string,
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

export async function deletePickupSpot(id: number) {
  await sql`DELETE FROM pickup_spots WHERE id = ${id}`;
}
