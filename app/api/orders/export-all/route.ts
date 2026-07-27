import { NextResponse } from "next/server";
import { getOrders } from "@/app/lib/orders";
import { jsonHandler } from "@/app/lib/api";
import { buildAllOrdersWorkbook } from "@/app/lib/order-export";
import { safeFilename, taipeiDateStamp } from "@/app/lib/csv";

// 一鍵匯出所有訂單：不分路線篩選，全部訂單匯成單一分頁的 xlsx
// （依路線排序、各路線之間空一列，欄位與「匯出選取訂單」相同）。
// 僅下載、不清除任何資料，可重複匯出。
export const GET = jsonHandler(async () => {
  const orders = await getOrders();
  if (orders.length === 0) {
    return NextResponse.json({ error: "目前沒有訂單" }, { status: 400 });
  }

  const bytes = buildAllOrdersWorkbook(orders);
  const filename = safeFilename(`訂單_全部_${taipeiDateStamp()}.xlsx`);

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
