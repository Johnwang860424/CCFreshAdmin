import { NextResponse } from "next/server";
import { getOrders } from "@/app/lib/orders";

export async function GET() {
  try {
    const orders = await getOrders();
    return NextResponse.json(orders);
  } catch (err) {
    console.error("Failed to fetch orders:", err);
    return NextResponse.json({ error: "無法讀取訂單資料" }, { status: 500 });
  }
}
