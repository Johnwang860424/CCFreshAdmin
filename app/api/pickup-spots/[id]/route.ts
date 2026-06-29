import { NextResponse } from "next/server";
import {
  deletePickupSpot,
  updatePickupSpotTownship,
  PickupSpotInUseError,
  PickupSpotDuplicateError,
} from "@/app/lib/pickup-spots";
import { jsonHandler } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { parseId } from "@/app/lib/validation";

type Params = { params: Promise<{ id: string }> };

export const PUT = jsonHandler<Params>(async (request, { params }) => {
  const { id: idStr } = await params;
  const parsed = parseId(idStr);
  if ("error" in parsed) return parsed.error;
  const { id } = parsed;

  // 僅接受 township；任何傳入的 city 一律忽略（所屬縣市不可更改）。
  const { township } = (await request.json()) as { township?: string };
  const value = typeof township === "string" ? township.trim() : "";
  if (!value) {
    return NextResponse.json({ error: "地點為必填欄位" }, { status: 400 });
  }

  try {
    await updatePickupSpotTownship(id, value);
  } catch (err) {
    if (err instanceof PickupSpotDuplicateError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  await revalidateCache("pickup-spots");
  return { success: true };
}, "更新自取地點失敗");

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
