import { reorderProductsSummary } from "@/app/lib/products";
import { badRequest, jsonHandler, readJson } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { validateReorderBody } from "@/app/lib/validation";

export const PUT = jsonHandler(async (request) => {
  const body = await readJson(request);
  const parsed = validateReorderBody(body);
  if ("error" in parsed) return badRequest(parsed.error);

  await reorderProductsSummary(parsed.value);
  await revalidateCache("products");
  return { success: true };
}, "更新統計排序失敗");
