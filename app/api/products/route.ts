import { getProducts, addProduct } from "@/app/lib/products";
import { jsonHandler } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { validateProductBody } from "@/app/lib/validation";

export const GET = jsonHandler(getProducts, "無法讀取商品資料");

export const POST = jsonHandler(async (request) => {
  const body = await request.json();
  const parsed = validateProductBody(body, { requireName: true });
  if ("error" in parsed) return parsed.error;
  const p = parsed.value;

  await addProduct(
    p.name,
    p.price,
    p.imageUrl,
    p.categoryId,
    p.spec,
    p.description,
    p.promoType,
    p.promoConfig,
  );
  await revalidateCache("products");
  await revalidateCache("categories");
  return { success: true };
}, "新增商品失敗");
