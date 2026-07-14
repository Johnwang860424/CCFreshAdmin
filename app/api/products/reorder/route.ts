import { reorderProducts } from "@/app/lib/products";
import { badRequest, jsonHandler } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { validateReorderBody } from "@/app/lib/validation";

export const PUT = jsonHandler(async (request) => {
  const body = await request.json();
  const parsed = validateReorderBody(body);
  if ("error" in parsed) return badRequest(parsed.error);

  await reorderProducts(parsed.value);
  await revalidateCache("products");
  return { success: true };
}, "更新商品排序失敗");
