import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProducts, addProduct } from "@/app/lib/products";
import { jsonHandler } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import {
  validateProductBody,
  validateProductImages,
} from "@/app/lib/validation";

export const GET = jsonHandler(getProducts, "無法讀取商品資料");

/** 變更資料端點的縱深防禦：middleware 之外再顯式檢查登入（憲章原則 III）。 */
async function requireAuth(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未授權" }, { status: 401 });
  }
  return null;
}

export const POST = jsonHandler(async (request) => {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json();
  const parsed = validateProductBody(body, { requireName: true });
  if ("error" in parsed) return parsed.error;
  const p = parsed.value;

  const images = validateProductImages((body as { imageUrls?: unknown }).imageUrls);
  if ("error" in images) return images.error;

  await addProduct(
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
