import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";

export interface ProductRow {
  id: number;
  name: string;
  price: number; // NT$ 整數
  imageUrl: string;
  categoryId: number | null;
  categoryName: string | null;
  spec: string | null;
  description: string | null;
}

export const getProducts = unstable_cache(
  async (): Promise<ProductRow[]> => {
    const rows = await sql`
      SELECT
        p.id,
        p.name,
        p.price,
        p.image_url,
        p.category_id,
        c.name AS category_name,
        p.spec,
        p.description
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.id
    `;
    return rows.map((r) => ({
      id: r.id as number,
      name: r.name as string,
      price: r.price as number,
      imageUrl: r.image_url as string,
      categoryId: (r.category_id as number | null) ?? null,
      categoryName: (r.category_name as string | null) ?? null,
      spec: (r.spec as string | null) ?? null,
      description: (r.description as string | null) ?? null,
    }));
  },
  ["products"],
  { tags: ["products"] },
);

export async function addProduct(
  name: string,
  price: number,
  imageUrl: string,
  categoryId: number,
  spec: string | null,
  description: string | null,
) {
  await sql`
    INSERT INTO products (name, price, image_url, category_id, spec, description)
    VALUES (${name}, ${price}, ${imageUrl}, ${categoryId}, ${spec}, ${description})
  `;
}

export async function updateProductDetails(
  id: number,
  price: number,
  imageUrl: string,
  categoryId: number,
  spec: string | null,
  description: string | null,
) {
  await sql`
    UPDATE products
    SET price = ${price},
        image_url = ${imageUrl},
        category_id = ${categoryId},
        spec = ${spec},
        description = ${description}
    WHERE id = ${id}
  `;
}

export async function deleteProduct(id: number) {
  await sql`DELETE FROM products WHERE id = ${id}`;
}

/** 直接查最新的 image_url（不經快取），避免刪除時用到過時資料。 */
export async function getProductImageUrl(id: number): Promise<string | null> {
  const rows = await sql`SELECT image_url FROM products WHERE id = ${id}`;
  return (rows[0]?.image_url as string | null) ?? null;
}
