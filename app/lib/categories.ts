import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";

export interface CategoryRow {
  id: number;
  name: string;
  productCount: number;
}

export const getCategories = unstable_cache(
  async (): Promise<CategoryRow[]> => {
    const rows = await sql`
      SELECT c.id, c.name, COUNT(p.id) AS product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id, c.name
      ORDER BY c.id
    `;
    return rows.map((r) => ({
      id: r.id as number,
      name: r.name as string,
      productCount: Number(r.product_count),
    }));
  },
  ["categories"],
  { tags: ["categories"] },
);

export async function addCategory(name: string) {
  await sql`INSERT INTO categories (name) VALUES (${name})`;
}

export async function renameCategory(id: number, name: string) {
  await sql`UPDATE categories SET name = ${name} WHERE id = ${id}`;
}

export async function deleteCategory(id: number) {
  await sql`DELETE FROM categories WHERE id = ${id}`;
}

export async function countProductsInCategory(id: number): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*) AS count FROM products WHERE category_id = ${id}
  `;
  return Number(rows[0].count);
}
