import { NextResponse } from "next/server";
import { getPickupSpots, addPickupSpot } from "@/app/lib/pickup-spots";
import { revalidateCache } from "@/app/lib/revalidate";

export async function GET() {
  try {
    const spots = await getPickupSpots();
    return NextResponse.json(spots);
  } catch (err) {
    console.error("Failed to fetch pickup spots:", err);
    return NextResponse.json(
      { error: "無法讀取自取地點資料" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { city, township } = body as { city: string; township: string };

    if (!city || !township) {
      return NextResponse.json(
        { error: "縣市和鄉鎮為必填欄位" },
        { status: 400 },
      );
    }

    await addPickupSpot(city, township);
    await revalidateCache("pickup-spots");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to add pickup spot:", err);
    return NextResponse.json({ error: "新增自取地點失敗" }, { status: 500 });
  }
}
