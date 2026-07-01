import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { auth } from "@/auth";
import {
  getOrders,
  getCloseGroups,
  deleteOrdersByGroup,
  type OrderRow,
} from "@/app/lib/orders";
import { jsonHandler } from "@/app/lib/api";
import { safeFilename, taipeiDateStamp } from "@/app/lib/csv";

interface GroupBody {
  method?: string;
  routeId?: number | null;
}

/** 分組匯出/出貨屬敏感/變更資料操作：middleware 之外再顯式檢查登入（憲章原則 III）。 */
async function requireAuth(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未授權" }, { status: 401 });
  }
  return null;
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

/** 匯出的欄位表頭（各縣市分頁共用）。 */
const EXPORT_HEADER = [
  "取貨號",
  "客戶姓名",
  "取貨地點",
  "購買清單",
  "訂單總額",
  "電話",
  "備註",
];

/** 單筆訂單轉為一列（電話以文字保留，避免掉開頭 0；xlsx 字串即文字格）。 */
function orderToRow(order: OrderRow): (string | number)[] {
  return [
    order.pickupNumber ?? "",
    order.customerName,
    // 取貨地點：自取帶入「鄉鎮」（縣市已由分頁區分），宅配帶入收件地址
    order.deliveryMethod === "delivery"
      ? (order.shippingAddress ?? "")
      : (order.pickupSpotTownship ?? ""),
    order.items.map((item) => `${item.productName}*${item.quantity}`).join("/"),
    order.total,
    order.phone ?? "",
    order.note ?? "",
  ];
}

/** 縣市 → 合法的 Excel 工作表名稱（≤31 字、不含 : \ / ? * [ ]，且不可空）。 */
function toSheetName(city: string): string {
  const cleaned = city.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31);
  return cleaned || "其他";
}

// 列出可結單分組（各組筆數），供結單視窗顯示。
export const GET = jsonHandler(async () => {
  const groups = await getCloseGroups();
  return { groups };
}, "無法讀取結單分組");

// 匯出 Excel：僅下載該分組的訂單，不刪除任何資料，可重複匯出（與出貨為兩個獨立動作）。
// 依「縣市」分成不同工作表（tab），tab 名稱即縣市；宅配、無取貨點者另成一頁。
export const POST = jsonHandler(async (request) => {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = (await request.json().catch(() => ({}))) as GroupBody;
  const allOrders = await getOrders();
  const orders = filterGroup(allOrders, body);

  if (orders.length === 0) {
    return NextResponse.json({ error: "此分組目前沒有訂單" }, { status: 400 });
  }

  // 依縣市分頁：宅配歸「宅配」、自取無縣市（取貨點已刪除）歸「未分縣市」。
  const byCity = new Map<string, OrderRow[]>();
  for (const order of orders) {
    const city =
      order.deliveryMethod === "delivery"
        ? "宅配"
        : (order.pickupSpotCity ?? "未分縣市");
    const bucket = byCity.get(city);
    if (bucket) bucket.push(order);
    else byCity.set(city, [order]);
  }

  // 分頁順序：以縣市名稱穩定排序（zh-Hant）。
  const cities = [...byCity.keys()].sort((a, b) => a.localeCompare(b, "zh-Hant"));

  const wb = XLSX.utils.book_new();
  for (const city of cities) {
    const aoa = [EXPORT_HEADER, ...byCity.get(city)!.map(orderToRow)];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, toSheetName(city));
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const groupName =
    body.method === "delivery" ? "宅配" : (orders[0].routeName ?? "未分路線");
  const filename = safeFilename(`orders_${groupName}_${taipeiDateStamp()}.xlsx`);

  return new Response(new Uint8Array(buf), {
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
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = (await request.json().catch(() => ({}))) as GroupBody;
  await deleteOrdersByGroup(body.method ?? "pickup", body.routeId ?? null);
  return { success: true };
}, "清除訂單失敗");
