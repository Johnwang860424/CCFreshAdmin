import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";
import { getPromoStrategy, type PromoConfig } from "@/app/lib/promotions";

/** DB 原始列（snake_case）。 */
interface ProductDbRow {
  id: number;
  code: string;
  name: string;
  price: number;
  category_id: number;
  category_name: string | null;
  spec: string | null;
  description: string | null;
  promo_type: string | null;
  promo_config: PromoConfig | null;
  sort_order: number;
  /** 路線訂單統計的商品欄順序（與 sort_order 各自獨立維護）。 */
  summary_sort_order: number;
  /** 剩餘可售數量；NULL＝不限量（不追蹤庫存）。 */
  stock: number | null;
  images: string[];
}

/** 對外回傳的商品列（camelCase，附優惠摘要文字）。 */
export interface ProductRow {
  id: number;
  code: string;
  name: string;
  price: number;
  /** 封面圖：衍生自 images[0]（`products` 已無 image_url 欄）。無圖時為空字串。 */
  imageUrl: string;
  categoryId: number;
  categoryName: string | null;
  spec: string | null;
  description: string | null;
  promoType: string | null;
  promoConfig: PromoConfig | null;
  promoSummary: string | null;
  sortOrder: number;
  /** 路線訂單統計的商品欄順序（與 sortOrder 各自獨立維護）。 */
  summarySortOrder: number;
  /** 剩餘可售數量；null＝不限量（不追蹤庫存）、0＝售完。訂單成立時原子扣減。 */
  stock: number | null;
  /** 依 sort_order 排好的完整圖片 URL 陣列（1–8 張）；images[0] 即封面（= imageUrl）。 */
  images: string[];
}

function toProductRow(row: ProductDbRow): ProductRow {
  const strategy = row.promo_type
    ? getPromoStrategy(row.promo_type)
    : undefined;
  const promoConfig = row.promo_config ?? null;
  const promoSummary =
    strategy && promoConfig ? strategy.describe(promoConfig) : null;
  const images = row.images ?? [];
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    price: row.price,
    imageUrl: images[0] ?? "",
    categoryId: row.category_id,
    categoryName: row.category_name ?? null,
    spec: row.spec ?? null,
    description: row.description ?? null,
    promoType: row.promo_type ?? null,
    promoConfig,
    promoSummary,
    sortOrder: row.sort_order,
    summarySortOrder: row.summary_sort_order,
    stock: row.stock ?? null,
    images,
  };
}

export const getProducts = unstable_cache(
  async (): Promise<ProductRow[]> => {
    const rows = (await sql`
      SELECT
        p.id,
        p.code,
        p.name,
        p.price,
        p.category_id,
        c.name AS category_name,
        p.spec,
        p.description,
        p.promo_type,
        p.promo_config,
        p.sort_order,
        p.summary_sort_order,
        p.stock,
        COALESCE(
          (
            SELECT array_agg(pi.image_url ORDER BY pi.sort_order)
            FROM product_images pi
            WHERE pi.product_id = p.id
          ),
          ARRAY[]::text[]
        ) AS images
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
  code: string,
  name: string,
  price: number,
  imageUrls: string[],
  categoryId: number,
  spec: string | null,
  description: string | null,
  promoType: string | null,
  promoConfig: PromoConfig | null,
  stock: number | null,
) {
  const configJson = promoConfig === null ? null : JSON.stringify(promoConfig);
  // 單一原子語句（CTE）：插入 products（sort_order 與 summary_sort_order 各取 MAX+1 排在兩套排序的最後、
  // 回傳新 id），再依序插入其 product_images（unnest WITH ORDINALITY 給 sort_order 1..n）。封面即 sort_order=1。
  await sql`
    WITH new_product AS (
      INSERT INTO products (code, name, price, category_id, spec, description, promo_type, promo_config, sort_order, summary_sort_order, stock)
      VALUES (
        ${code}, ${name}, ${price}, ${categoryId}, ${spec}, ${description}, ${promoType}, ${configJson}::jsonb,
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products),
        (SELECT COALESCE(MAX(summary_sort_order), 0) + 1 FROM products),
        ${stock}
      )
      RETURNING id
    )
    INSERT INTO product_images (product_id, image_url, sort_order)
    SELECT np.id, u.url, u.ord
    FROM new_product np,
         unnest(${imageUrls}::text[]) WITH ORDINALITY AS u(url, ord)
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

/**
 * 依傳入的 id 順序原子重寫所有商品的 summary_sort_order（1-based，路線訂單統計用）。
 * 與 reorderProducts 同一模式；陣列中已不存在於 DB 的 id 會被 WHERE 自然略過。
 */
export async function reorderProductsSummary(ids: number[]) {
  await sql`
    UPDATE products AS p
    SET summary_sort_order = v.ord
    FROM (
      SELECT id, ord
      FROM unnest(${ids}::int[]) WITH ORDINALITY AS t(id, ord)
    ) AS v
    WHERE p.id = v.id
  `;
}

/**
 * Atomically updates product details and replaces its ordered image set.
 * Returning false means the product no longer exists.
 */
export async function updateProduct(
  id: number,
  code: string,
  price: number,
  imageUrls: string[],
  categoryId: number,
  spec: string | null,
  description: string | null,
  promoType: string | null,
  promoConfig: PromoConfig | null,
  stock: number | null,
): Promise<boolean> {
  const configJson = promoConfig === null ? null : JSON.stringify(promoConfig);
  const rows = await sql`
    WITH updated_product AS (
      UPDATE products
      SET code = ${code},
          price = ${price},
          category_id = ${categoryId},
          spec = ${spec},
          description = ${description},
          promo_type = ${promoType},
          promo_config = ${configJson}::jsonb,
          stock = ${stock}
      WHERE id = ${id}
      RETURNING id
    ),
    deleted_images AS (
      DELETE FROM product_images pi
      USING updated_product p
      WHERE pi.product_id = p.id
    )
    INSERT INTO product_images (product_id, image_url, sort_order)
    SELECT p.id, u.url, u.ord
    FROM updated_product p
    CROSS JOIN unnest(${imageUrls}::text[]) WITH ORDINALITY AS u(url, ord)
    RETURNING product_id
  `;
  return rows.length > 0;
}

export async function deleteProduct(id: number): Promise<boolean> {
  const rows = await sql`DELETE FROM products WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

/**
 * 直接查某商品全部圖片 URL（不經快取），依 sort_order 排序。
 * 供更新時計算「舊−新」差集、以及刪除商品時清理全部 Cloudinary 圖使用。
 */
export async function getProductImageUrls(id: number): Promise<string[]> {
  const rows = (await sql`
    SELECT image_url FROM product_images WHERE product_id = ${id} ORDER BY sort_order
  `) as { image_url: string }[];
  return rows.map((r) => r.image_url);
}
