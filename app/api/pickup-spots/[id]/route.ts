import { NextResponse } from "next/server";
import {
  deletePickupSpot,
  updatePickupSpot,
  updatePickupSpotTownship,
  PickupSpotInUseError,
  PickupSpotDuplicateError,
} from "@/app/lib/pickup-spots";
import { jsonHandler } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { parseId, parseRouteId } from "@/app/lib/validation";

type Params = { params: Promise<{ id: string }> };

export const PUT = jsonHandler<Params>(async (request, { params }) => {
  const { id: idStr } = await params;
  const parsed = parseId(idStr);
  if ("error" in parsed) return parsed.error;
  const { id } = parsed;

  // 接受 township（必填）與選用 routeId；任何傳入的 city 一律忽略（所屬縣市不可更改）。
  // 僅在請求帶有 routeId 欄位時才更新所屬路線（路線管理頁）；否則只改地點（自取點管理頁，路線唯讀）。
  const body = (await request.json()) as {
    township?: string;
    routeId?: number | null;
  };
  const value = typeof body.township === "string" ? body.township.trim() : "";
  if (!value) {
    return NextResponse.json({ error: "地點為必填欄位" }, { status: 400 });
  }

  const hasRoute = "routeId" in body;
  const route = parseRouteId(body.routeId);
  if (hasRoute && "error" in route) return route.error;

  try {
    if (hasRoute) {
      await updatePickupSpot(id, value, "value" in route ? route.value : null);
    } else {
      await updatePickupSpotTownship(id, value);
    }
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
