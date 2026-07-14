import { NextResponse } from "next/server";
import {
  deletePickupSpot,
  updatePickupSpot,
  updatePickupSpotTownship,
  updatePickupSpotDetails,
  getPickupSpotCode,
  countOrdersBySpot,
  PickupSpotInUseError,
  PickupSpotDuplicateError,
  SpotCodeDuplicateError,
} from "@/app/lib/pickup-spots";
import { badRequest, jsonHandler } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { parseId, parseRouteId, parseSpotCode } from "@/app/lib/validation";

type Params = { params: Promise<{ id: string }> };

export const PUT = jsonHandler<Params>(async (request, { params }) => {
  const { id: idStr } = await params;
  const parsed = parseId(idStr);
  if ("error" in parsed) return badRequest(parsed.error);
  const { id } = parsed;

  // 接受 township（必填）與選用 routeId / code；任何傳入的 city 一律忽略（所屬縣市不可更改）。
  // - 帶 code（自取點管理頁）：更新地點與站點代碼；代碼有變且站點尚有訂單時需 confirmCodeChange
  //   確認（兩段式：先回 409 requiresConfirmation，前端確認後重送）。
  // - 帶 routeId（路線管理頁）：更新地點與所屬路線；站點帶著代碼移入已有同碼站的路線時，
  //   由同路線唯一鍵擋下回 409（SpotCodeDuplicateError）。
  const body = (await request.json()) as {
    township?: string;
    routeId?: number | null;
    code?: string;
    confirmCodeChange?: boolean;
  };
  const value = typeof body.township === "string" ? body.township.trim() : "";
  if (!value) {
    return NextResponse.json({ error: "地點為必填欄位" }, { status: 400 });
  }

  const hasRoute = "routeId" in body;
  const route = parseRouteId(body.routeId);
  if (hasRoute && "error" in route) return badRequest(route.error);

  const hasCode = "code" in body;
  const spotCode = parseSpotCode(body.code);
  if (hasCode && "error" in spotCode) return badRequest(spotCode.error);

  try {
    if (hasCode && "value" in spotCode) {
      // 改碼確認：訂單數以 DB 即時查詢為準（getPickupSpots 走快取、顧客端隨時寫入訂單，不可信）。
      const current = await getPickupSpotCode(id);
      if (
        current !== null &&
        current !== spotCode.value &&
        body.confirmCodeChange !== true
      ) {
        const orderCount = await countOrdersBySpot(id);
        if (orderCount > 0) {
          return NextResponse.json(
            {
              requiresConfirmation: true,
              orderCount,
              error: `此站點尚有 ${orderCount} 筆未出貨訂單，修改代碼將立即改變其取貨號`,
            },
            { status: 409 },
          );
        }
      }
      await updatePickupSpotDetails(id, value, spotCode.value);
    } else if (hasRoute) {
      await updatePickupSpot(id, value, "value" in route ? route.value : null);
    } else {
      await updatePickupSpotTownship(id, value);
    }
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
}, "更新自取地點失敗");

export const DELETE = jsonHandler<Params>(async (_request, { params }) => {
  const { id: idStr } = await params;
  const parsed = parseId(idStr);
  if ("error" in parsed) return badRequest(parsed.error);
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
