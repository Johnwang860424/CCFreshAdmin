import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";
import { getPromoStrategy, type PromoConfig } from "@/app/lib/promotions";

/** DB 原始列（snake_case）。 */
interface ProductDbRow {
  id: number;
  name: string;
  price: number;
  category_id: number;
  category_name: string | null;
  spec: string | null;
  description: string | null;
  promo_type: string | null;
  promo_config: PromoConfig | null;
  sort_order: number;
  images: string[];
}

/** 對外回傳的商品列（camelCase，附優惠摘要文字）。 */
export interface ProductRow {
  id: number;
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
    images,
  };
}

export const getProducts = unstable_cache(
  async (): Promise<ProductRow[]> => {
    const rows = (await sql`
      SELECT
        p.id,
        p.name,
        p.price,
        p.category_id,
        c.name AS category_name,
        p.spec,
        p.description,
        p.promo_type,
        p.promo_config,
        p.sort_order,
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
  name: string,
  price: number,
  imageUrls: string[],
  categoryId: number,
  spec: string | null,
  description: string | null,
  promoType: string | null,
  promoConfig: PromoConfig | null,
) {
  const configJson = promoConfig === null ? null : JSON.stringify(promoConfig);
  // 單一原子語句（CTE）：插入 products（sort_order 取 MAX+1 排在最後、回傳新 id），
  // 再依序插入其 product_images（unnest WITH ORDINALITY 給 sort_order 1..n）。封面即 sort_order=1。
  await sql`
    WITH new_product AS (
      INSERT INTO products (name, price, category_id, spec, description, promo_type, promo_config, sort_order)
      VALUES (
        ${name}, ${price}, ${categoryId}, ${spec}, ${description}, ${promoType}, ${configJson}::jsonb,
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products)
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
 * 依傳入的有序 URL 陣列原子重寫某商品的完整圖片集合。
 * 單一 SQL（CTE）達原子性：全刪該商品舊圖 → 依序插入新圖（sort_order 1..n）。
 * 封面即 sort_order=1，讀取時由 getProducts 衍生為 imageUrl，無需另存欄位。
 * 供更新商品與圖片排序共用。呼叫端須先以 validateProductImages 保證 1–8 張。
 */
export async function saveProductImages(productId: number, imageUrls: string[]) {
  await sql`
    WITH del AS (
      DELETE FROM product_images WHERE product_id = ${productId}
    )
    INSERT INTO product_images (product_id, image_url, sort_order)
    SELECT ${productId}, u.url, u.ord
    FROM unnest(${imageUrls}::text[]) WITH ORDINALITY AS u(url, ord)
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
 * 更新商品的非圖片欄位。圖片集合與封面（image_url）改由 saveProductImages 維護，
 * 故此處不再寫 image_url，避免兩處來源分歧。
 */
export async function updateProductDetails(
  id: number,
  price: number,
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
