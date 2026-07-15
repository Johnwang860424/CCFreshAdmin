import { NextResponse } from "next/server";
import {
  getOrdersByRoute,
  getOrderRoutes,
  getDeliveryOrders,
  createOrder,
  getOrderById,
  countSameNameOrdersInGroup,
  OrderInputError,
} from "@/app/lib/orders";
import { badRequest, jsonHandler, readJson } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { validateCreateOrderBody } from "@/app/lib/validation";

// 訂單查詢：
// - 無參數 → 回傳有訂單的路線清單、是否有未分路線訂單、是否有宅配訂單（供篩選下拉）。
//   進到畫面時僅取清單，不載入全部訂單。
// - method=delivery → 回傳所有宅配訂單（含明細）。宅配無取貨點/路線。
// - route=<id> / route=unassigned → 回傳該路線（未分路線）的自取訂單（含明細）。
export const GET = jsonHandler(async (request) => {
  const params = new URL(request.url).searchParams;
  const method = params.get("method");
  const route = params.get("route");

  if (method === "delivery") {
    return getDeliveryOrders();
  }

  if (!route) {
    return getOrderRoutes();
  }

  if (route === "unassigned") {
    return getOrdersByRoute(null);
  }

  const n = Number(route);
  if (!Number.isInteger(n) || n <= 0) {
    return NextResponse.json({ error: "無效的路線" }, { status: 400 });
  }
  return getOrdersByRoute(n);
}, "無法讀取訂單資料");

export const POST = jsonHandler(async (request) => {
  const body = await readJson(request);
  const parsed = validateCreateOrderBody(body);
  if ("error" in parsed) return badRequest(parsed.error);

  // 重複下單警示（兩段式）：同路線分組已有同名訂單且未帶確認旗標時，
  // 先回 409 requiresConfirmation，前端確認後帶 confirmDuplicate: true 重送。
  if ((body as { confirmDuplicate?: unknown })?.confirmDuplicate !== true) {
    const duplicateCount = await countSameNameOrdersInGroup(parsed.value);
    if (duplicateCount > 0) {
      return NextResponse.json(
        {
          requiresConfirmation: true,
          duplicateCount,
          error: "系統偵測到您可能已有訂單，請確認是否為重複下單",
        },
        { status: 409 },
      );
    }
  }

  try {
    const id = await createOrder(parsed.value);
    // 訂單成立已扣減庫存：革除商品快取，讓商品列表/訂單商品選單顯示最新剩餘量。
    await revalidateCache("products");
    const order = await getOrderById(id);
    return {
      success: true,
      id,
      pickupNumber: order?.pickupNumber ?? null,
      spotCode: order?.spotCode ?? null,
    };
  } catch (err) {
    if (err instanceof OrderInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}, "新增訂單失敗");
