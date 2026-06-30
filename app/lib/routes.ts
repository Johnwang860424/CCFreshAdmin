import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";

interface RouteDbRow {
  id: number;
  name: string;
  spot_count: number;
}

export interface RouteRow {
  id: number;
  name: string;
  spotCount: number;
}

export const getRoutes = unstable_cache(
  async (): Promise<RouteRow[]> => {
    const rows = (await sql`
      SELECT r.id, r.name, COUNT(ps.id) AS spot_count
      FROM routes r
      LEFT JOIN pickup_spots ps ON ps.route_id = r.id
      GROUP BY r.id, r.name
      ORDER BY r.id
    `) as RouteDbRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      spotCount: Number(r.spot_count),
    }));
  },
  ["routes"],
  { tags: ["routes"] },
);

export async function addRoute(name: string) {
  await sql`INSERT INTO routes (name) VALUES (${name})`;
}

export async function renameRoute(id: number, name: string) {
  await sql`UPDATE routes SET name = ${name} WHERE id = ${id}`;
}

export async function deleteRoute(id: number) {
  await sql`DELETE FROM routes WHERE id = ${id}`;
}

export async function countSpotsInRoute(id: number): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*) AS count FROM pickup_spots WHERE route_id = ${id}
  `;
  return Number(rows[0].count);
}
