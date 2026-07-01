import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  updateOrderItems,
  deleteOrder,
  OrderInputError,
} from "@/app/lib/orders";
import { jsonHandler } from "@/app/lib/api";
import { parseId, validateUpdateOrderItemsBody } from "@/app/lib/validation";

type Params = { params: Promise<{ id: string }> };

/** 變更資料端點的縱深防禦：middleware 之外再顯式檢查登入（憲章原則 III）。 */
async function requireAuth(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未授權" }, { status: 401 });
  }
  return null;
}

// 修改訂單品項（新增/移除/改數量）。金額一律後端計算：既有明細保留原始快照、
// 新增明細取商品現價快照；重算 orders.total。訂單並發消失回 404。
export const PUT = jsonHandler<Params>(async (request, { params }) => {
  const unauth = await requireAuth();
  if (unauth) return unauth;

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
  const unauth = await requireAuth();
  if (unauth) return unauth;

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
  return { success: true };
}, "刪除訂單失敗");
