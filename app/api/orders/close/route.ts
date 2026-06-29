import { NextResponse } from "next/server";
import {
  getOrders,
  getCloseGroups,
  deleteOrdersByGroup,
  type OrderRow,
} from "@/app/lib/orders";
import { jsonHandler } from "@/app/lib/api";
import { buildCsv, safeFilename, taipeiDateStamp } from "@/app/lib/csv";

interface GroupBody {
  method?: string;
  pickupSpotId?: number | null;
}

/** 取出某一結單分組的訂單：宅配為一組，自取則依 pickup_spot_id 分組 */
function filterGroup(orders: OrderRow[], body: GroupBody): OrderRow[] {
  if (body.method === "delivery") {
    return orders.filter((o) => o.deliveryMethod === "delivery");
  }
  const spotId = body.pickupSpotId ?? null;
  return orders.filter(
    (o) => o.deliveryMethod === "pickup" && (o.pickupSpotId ?? null) === spotId,
  );
}

// 列出可結單分組（各組筆數），供結單視窗顯示。
export const GET = jsonHandler(async () => {
  const groups = await getCloseGroups();
  return { groups };
}, "無法讀取結單分組");

// 結單第一步：僅匯出該分組的 CSV，不刪除任何資料。
// 客戶端確認成功下載後，再呼叫 DELETE 清除該分組，避免下載失敗造成資料遺失。
export const POST = jsonHandler(async (request) => {
  const body = (await request.json().catch(() => ({}))) as GroupBody;
  const allOrders = await getOrders();
  const orders = filterGroup(allOrders, body);

  if (orders.length === 0) {
    return NextResponse.json(
      { error: "此分組目前沒有訂單可結單" },
      { status: 400 },
    );
  }

  const header = [
    "取貨號",
    "客戶姓名",
    "來源",
    "取貨地點",
    "購買清單",
    "訂單總額",
    "電話",
    "備註",
  ];

  const rows = orders.map((order) => [
    order.pickupNumber ?? "",
    order.customerName,
    order.tag,
    // 取貨地點：自取帶入鄉鎮（不含縣市），宅配帶入收件地址
    order.deliveryMethod === "delivery"
      ? (order.shippingAddress ?? "")
      : (order.pickupSpotTownship ?? ""),
    order.items
      .map((item) => `${item.productName}*${item.quantity}`)
      .join("/"),
    order.total,
    // 以 Excel 文字公式輸出，避免開啟 CSV 時把電話當數字而吃掉開頭的 0
    order.phone ? `="${order.phone}"` : "",
    order.note ?? "",
  ]);

  const csv = buildCsv([header, ...rows]);

  const groupName =
    body.method === "delivery" ? "宅配" : orders[0].pickupSpotLabel || "自取";
  const filename = safeFilename(`orders_${groupName}_${taipeiDateStamp()}.csv`);

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        filename,
      )}`,
    },
  });
}, "匯出訂單失敗");

// 結單第二步：客戶端確認 CSV 已成功下載後，才清除該分組的訂單。
export const DELETE = jsonHandler(async (request) => {
  const body = (await request.json().catch(() => ({}))) as GroupBody;
  await deleteOrdersByGroup(body.method ?? "pickup", body.pickupSpotId ?? null);
  return { success: true };
}, "清除訂單失敗");
