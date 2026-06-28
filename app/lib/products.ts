import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";
import { getPromoStrategy, type PromoConfig } from "@/app/lib/promotions";

/** DB 原始列（snake_case）。 */
interface ProductDbRow {
  id: number;
  name: string;
  price: number;
  image_url: string;
  category_id: number;
  category_name: string | null;
  spec: string | null;
  description: string | null;
  promo_type: string | null;
  promo_config: PromoConfig | null;
  sort_order: number;
}

/** 對外回傳的商品列（camelCase，附優惠摘要文字）。 */
export interface ProductRow {
  id: number;
  name: string;
  price: number;
  imageUrl: string;
  categoryId: number;
  categoryName: string | null;
  spec: string | null;
  description: string | null;
  promoType: string | null;
  promoConfig: PromoConfig | null;
  promoSummary: string | null;
  sortOrder: number;
}

function toProductRow(row: ProductDbRow): ProductRow {
  const strategy = row.promo_type
    ? getPromoStrategy(row.promo_type)
    : undefined;
  const promoConfig = row.promo_config ?? null;
  const promoSummary =
    strategy && promoConfig ? strategy.describe(promoConfig) : null;
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    imageUrl: row.image_url,
    categoryId: row.category_id,
    categoryName: row.category_name ?? null,
    spec: row.spec ?? null,
    description: row.description ?? null,
    promoType: row.promo_type ?? null,
    promoConfig,
    promoSummary,
    sortOrder: row.sort_order,
  };
}

export const getProducts = unstable_cache(
  async (): Promise<ProductRow[]> => {
    const rows = (await sql`
      SELECT
        p.id,
        p.name,
        p.price,
        p.image_url,
        p.category_id,
        c.name AS category_name,
        p.spec,
        p.description,
        p.promo_type,
        p.promo_config,
        p.sort_order
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.sort_order, p.id
    `) as ProductDbRow[];
    return rows.map(toProductRow);
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
  promoType: string | null,
  promoConfig: PromoConfig | null,
) {
  const configJson = promoConfig === null ? null : JSON.stringify(promoConfig);
  // sort_order 取目前最大值 +1，使新商品排在列表最後。
  await sql`
    INSERT INTO products (name, price, image_url, category_id, spec, description, promo_type, promo_config, sort_order)
    VALUES (
      ${name}, ${price}, ${imageUrl}, ${categoryId}, ${spec}, ${description}, ${promoType}, ${configJson}::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products)
    )
  `;
}

/**
 * 依傳入的 id 順序原子重寫所有商品的 sort_order（1-based）。
 * 單一 SQL 語句即達原子性（Neon serverless HTTP 無互動式交易）；
 * 陣列中已不存在於 DB 的 id 會被 WHERE 自然略過。
 */
export async function reorderProducts(ids: number[]) {
  await sql`
    UPDATE products AS p
    SET sort_order = v.ord
    FROM (
      SELECT id, ord
      FROM unnest(${ids}::int[]) WITH ORDINALITY AS t(id, ord)
    ) AS v
    WHERE p.id = v.id
  `;
}

export async function updateProductDetails(
  id: number,
  price: number,
  imageUrl: string,
  categoryId: number,
  spec: string | null,
  description: string | null,
  promoType: string | null,
  promoConfig: PromoConfig | null,
) {
  const configJson = promoConfig === null ? null : JSON.stringify(promoConfig);
  await sql`
    UPDATE products
    SET price = ${price},
        image_url = ${imageUrl},
        category_id = ${categoryId},
        spec = ${spec},
        description = ${description},
        promo_type = ${promoType},
        promo_config = ${configJson}::jsonb
    WHERE id = ${id}
  `;
}

export async function deleteProduct(id: number) {
  await sql`DELETE FROM products WHERE id = ${id}`;
}

/** 直接查最新的 image_url（不經快取），避免刪除時用到過時資料。 */
export async function getProductImageUrl(id: number): Promise<string | null> {
  const rows = (await sql`
    SELECT image_url FROM products WHERE id = ${id}
  `) as { image_url: string }[];
  return rows[0]?.image_url ?? null;
}
