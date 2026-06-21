import { NextResponse } from "next/server";
import { deletePickupSpot, PickupSpotInUseError } from "@/app/lib/pickup-spots";
import { jsonHandler } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { parseId } from "@/app/lib/validation";

type Params = { params: Promise<{ id: string }> };

export const DELETE = jsonHandler<Params>(async (_request, { params }) => {
  const { id: idStr } = await params;
  const parsed = parseId(idStr);
  if ("error" in parsed) return parsed.error;
  const { id } = parsed;

  try {
    await deletePickupSpot(id);
  } catch (err) {
    if (err instanceof PickupSpotInUseError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  await revalidateCache("pickup-spots");
  return { success: true };
}, "刪除自取地點失敗");
