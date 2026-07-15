import { NextResponse } from "next/server";
import { getOrdersByIds, deleteOrdersByIds } from "@/app/lib/orders";
import { badRequest, jsonHandler, readJson } from "@/app/lib/api";
import { validateOrderIdsBody } from "@/app/lib/validation";
import { buildOrdersWorkbook } from "@/app/lib/order-export";
import { safeFilename, taipeiDateStamp } from "@/app/lib/csv";

// 選取匯出：依訂單 id 清單匯出 xlsx（依縣市分頁），僅下載、不清除，可重複（與出貨為兩個獨立動作）。
export const POST = jsonHandler(async (request) => {
  const parsed = validateOrderIdsBody(await readJson(request));
  if ("error" in parsed) return badRequest(parsed.error);

  const orders = await getOrdersByIds(parsed.value);
  if (orders.length === 0) {
    return NextResponse.json(
      { error: "選取的訂單皆已不存在，請重新載入" },
      { status: 400 },
    );
  }

  const bytes = buildOrdersWorkbook(orders);
  const filename = safeFilename(`訂單_${taipeiDateStamp()}.xlsx`);

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        filename,
      )}`,
    },
  });
}, "匯出訂單失敗");

// 選取出貨：依訂單 id 清單永久清除訂單（order_items 由 CASCADE 清除），不下載檔案。
// 回傳實際刪除筆數；清單中已消失的 id 自然不計入，不因此整批失敗（FR-010）。
export const DELETE = jsonHandler(async (request) => {
  const parsed = validateOrderIdsBody(await readJson(request));
  if ("error" in parsed) return badRequest(parsed.error);

  const deleted = await deleteOrdersByIds(parsed.value);
  return { deleted };
}, "清除訂單失敗");
