import { NextResponse } from "next/server";
import { deletePickupSpot } from "@/app/lib/pickup-spots";
import { revalidateCache } from "@/app/lib/revalidate";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id: idStr } = await params;
    const id = Number(idStr);

    await deletePickupSpot(id);
    await revalidateCache("pickup-spots");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete pickup spot:", err);
    return NextResponse.json(
      { error: "刪除自取地點失敗" },
      { status: 500 }
    );
  }
}
