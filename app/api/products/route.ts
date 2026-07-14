import { getProducts, addProduct } from "@/app/lib/products";
import { badRequest, jsonHandler } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import {
  validateProductBody,
  validateProductImages,
} from "@/app/lib/validation";

export const GET = jsonHandler(getProducts, "無法讀取商品資料");

export const POST = jsonHandler(async (request) => {
  const body = await request.json();
  const parsed = validateProductBody(body, { requireName: true });
  if ("error" in parsed) return badRequest(parsed.error);
  const p = parsed.value;

  const images = validateProductImages((body as { imageUrls?: unknown }).imageUrls);
  if ("error" in images) return badRequest(images.error);

  await addProduct(
    p.code,
    p.name,
    p.price,
    images.value,
    p.categoryId,
    p.spec,
    p.description,
    p.promoType,
    p.promoConfig,
    p.stock,
  );
  await revalidateCache("products");
  await revalidateCache("categories");
  return { success: true };
}, "新增商品失敗");
