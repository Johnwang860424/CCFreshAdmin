import { NextResponse } from "next/server";
import { getPickupSpots, addPickupSpot } from "@/app/lib/pickup-spots";
import { jsonHandler } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";

export const GET = jsonHandler(getPickupSpots, "無法讀取自取地點資料");

export const POST = jsonHandler(async (request) => {
  const body = await request.json();
  const { city, township } = body as { city: string; township: string };

  if (!city || !township) {
    return NextResponse.json({ error: "縣市和地點為必填欄位" }, { status: 400 });
  }

  await addPickupSpot(city, township);
  await revalidateCache("pickup-spots");
  return { success: true };
}, "新增自取地點失敗");
