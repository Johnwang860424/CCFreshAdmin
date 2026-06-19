import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";

export interface ProductRow {
  id: number;
  name: string;
  price: number; // NT$ 整數
  imageUrl: string;
}

export const getProducts = unstable_cache(
  async (): Promise<ProductRow[]> => {
    const rows = await sql`
      SELECT id, name, price, image_url
      FROM products
      ORDER BY id
    `;
    return rows.map((r) => ({
      id: r.id as number,
      name: r.name as string,
      price: r.price as number,
      imageUrl: r.image_url as string,
    }));
  },
  ["products"],
  { tags: ["products"] },
);

export async function addProduct(
  name: string,
  price: number,
  imageUrl: string,
) {
  await sql`
    INSERT INTO products (name, price, image_url)
    VALUES (${name}, ${price}, ${imageUrl})
  `;
}

export async function updateProductDetails(
  id: number,
  price: number,
  imageUrl: string,
) {
  await sql`
    UPDATE products
    SET price = ${price}, image_url = ${imageUrl}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function deleteProduct(id: number) {
  await sql`DELETE FROM products WHERE id = ${id}`;
}
