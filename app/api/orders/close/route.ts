import { NextResponse } from "next/server";
import {
  getOrders,
  getCloseGroups,
  deleteOrdersByGroup,
  type OrderRow,
} from "@/app/lib/orders";
import { jsonHandler, readJson } from "@/app/lib/api";
import { buildOrdersWorkbook } from "@/app/lib/order-export";
import { safeFilename, taipeiDateStamp } from "@/app/lib/csv";

interface GroupBody {
  method?: string;
  routeId?: number | null;
}

/** 取出某一結單分組的訂單：宅配為一組，自取則依「路線」（含未分路線）分組 */
function filterGroup(orders: OrderRow[], body: GroupBody): OrderRow[] {
  if (body.method === "delivery") {
    return orders.filter((o) => o.deliveryMethod === "delivery");
  }
  const routeId = body.routeId ?? null;
  return orders.filter(
    (o) => o.deliveryMethod === "pickup" && (o.routeId ?? null) === routeId,
  );
}

// 列出可結單分組（各組筆數），供結單視窗顯示。
export const GET = jsonHandler(async () => {
  const groups = await getCloseGroups();
  return { groups };
}, "無法讀取結單分組");

// 匯出 Excel：僅下載該分組的訂單，不刪除任何資料，可重複匯出（與出貨為兩個獨立動作）。
// 依「縣市」分成不同工作表（tab），tab 名稱即縣市；宅配、無取貨點者另成一頁。
export const POST = jsonHandler(async (request) => {
  const body = (await readJson(request)) as GroupBody;
  const allOrders = await getOrders();
  const orders = filterGroup(allOrders, body);

  if (orders.length === 0) {
    return NextResponse.json({ error: "此分組目前沒有訂單" }, { status: 400 });
  }

  // 依縣市分頁組裝 xlsx（與選取匯出共用同一組裝規則）。
  const bytes = buildOrdersWorkbook(orders);

  const groupName =
    body.method === "delivery" ? "宅配" : (orders[0].routeName ?? "未分路線");
  const filename = safeFilename(`orders_${groupName}_${taipeiDateStamp()}.xlsx`);

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

// 出貨：永久清除該分組的訂單，不下載檔案（與匯出為兩個獨立動作）。
export const DELETE = jsonHandler(async (request) => {
  const body = (await readJson(request)) as GroupBody;
  await deleteOrdersByGroup(body.method ?? "pickup", body.routeId ?? null);
  return { success: true };
}, "清除訂單失敗");
