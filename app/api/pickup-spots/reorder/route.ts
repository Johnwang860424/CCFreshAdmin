import { reorderPickupSpots } from "@/app/lib/pickup-spots";
import { badRequest, jsonHandler, readJson } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { validatePickupReorderBody } from "@/app/lib/validation";

export const PUT = jsonHandler(async (request) => {
  const body = await readJson(request);
  const parsed = validatePickupReorderBody(body);
  if ("error" in parsed) return badRequest(parsed.error);

  await reorderPickupSpots(parsed.value.city, parsed.value.ids);
  await revalidateCache("pickup-spots");
  return { success: true };
}, "更新自取點排序失敗");
