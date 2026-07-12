import { NextResponse } from "next/server";
import {
  updateOrderItems,
  deleteOrder,
  OrderInputError,
} from "@/app/lib/orders";
import { jsonHandler } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { parseId, validateUpdateOrderItemsBody } from "@/app/lib/validation";

type Params = { params: Promise<{ id: string }> };

// 修改訂單品項（新增/移除/改數量）。金額一律後端計算：既有明細保留原始快照、
// 新增明細取商品現價快照；重算 orders.total。訂單並發消失回 404。
export const PUT = jsonHandler<Params>(async (request, { params }) => {
  const { id: idStr } = await params;
  const parsedId = parseId(idStr);
  if ("error" in parsedId) return parsedId.error;

  const body = await request.json().catch(() => ({}));
  const parsed = validateUpdateOrderItemsBody(body);
  if ("error" in parsed) return parsed.error;

  try {
    const order = await updateOrderItems(parsedId.id, parsed.value.items);
    if (!order) {
      return NextResponse.json(
        { error: "訂單不存在，可能已被刪除或出貨" },
        { status: 404 },
      );
    }
    // 品項淨差額已同步扣/補庫存：革除商品快取，讓列表/選單顯示最新剩餘量。
    await revalidateCache("products");
    return order;
  } catch (err) {
    if (err instanceof OrderInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}, "修改訂單失敗");

// 刪除單筆訂單（明細由 ON DELETE CASCADE 一併清除）。
export const DELETE = jsonHandler<Params>(async (_request, { params }) => {
  const { id: idStr } = await params;
  const parsedId = parseId(idStr);
  if ("error" in parsedId) return parsedId.error;

  const deleted = await deleteOrder(parsedId.id);
  if (!deleted) {
    return NextResponse.json(
      { error: "訂單不存在，可能已被刪除或出貨" },
      { status: 404 },
    );
  }
  // 刪單已回補庫存：革除商品快取，讓列表/選單顯示最新剩餘量。
  await revalidateCache("products");
  return { success: true };
}, "刪除訂單失敗");
