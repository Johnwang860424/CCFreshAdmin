import { NextResponse } from "next/server";
import { getPickupSpots, addPickupSpot } from "@/app/lib/pickup-spots";
import { jsonHandler } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { parseRouteId } from "@/app/lib/validation";

export const GET = jsonHandler(getPickupSpots, "無法讀取自取地點資料");

export const POST = jsonHandler(async (request) => {
  const body = await request.json();
  const { city, township, routeId } = body as {
    city: string;
    township: string;
    routeId?: number | null;
  };

  if (!city || !township) {
    return NextResponse.json({ error: "縣市和地點為必填欄位" }, { status: 400 });
  }

  const route = parseRouteId(routeId);
  if ("error" in route) return route.error;

  await addPickupSpot(city, township, route.value);
  await revalidateCache("pickup-spots");
  return { success: true };
}, "新增自取地點失敗");
