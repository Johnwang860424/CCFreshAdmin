import { NextResponse } from "next/server";
import {
  getPickupSpots,
  addPickupSpot,
  PickupSpotDuplicateError,
  SpotCodeDuplicateError,
} from "@/app/lib/pickup-spots";
import { badRequest, jsonHandler, readJson } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { parseRouteId, parseSpotCode } from "@/app/lib/validation";

export const GET = jsonHandler(getPickupSpots, "無法讀取自取地點資料");

export const POST = jsonHandler(async (request) => {
  const body = await readJson(request);
  const { city, township, routeId, code } = body as {
    city: string;
    township: string;
    routeId?: number | null;
    code?: string;
  };

  if (!city || !township) {
    return NextResponse.json({ error: "縣市和地點為必填欄位" }, { status: 400 });
  }

  const route = parseRouteId(routeId);
  if ("error" in route) return badRequest(route.error);

  const spotCode = parseSpotCode(code);
  if ("error" in spotCode) return badRequest(spotCode.error);

  try {
    await addPickupSpot(city, township, route.value, spotCode.value);
  } catch (err) {
    if (
      err instanceof SpotCodeDuplicateError ||
      err instanceof PickupSpotDuplicateError
    ) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  await revalidateCache("pickup-spots");
  return { success: true };
}, "新增自取地點失敗");
