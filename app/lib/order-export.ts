// 訂單匯出：由 OrderRow[] 組裝「依縣市分頁」的 xlsx 活頁簿。
// 供分組匯出（app/api/orders/close）與選取匯出（app/api/orders/selection）共用，
// 確保兩處匯出的欄位與分頁規則一致。
import * as XLSX from "xlsx";
import type { OrderRow } from "@/app/lib/orders";

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

/**
 * 由訂單陣列組裝 xlsx 活頁簿並回傳位元組。
 * 依「縣市」分成不同工作表（tab）：宅配歸「宅配」頁、自取無縣市（取貨點已刪除）歸「未分縣市」頁；
 * 分頁順序以縣市名稱穩定排序（zh-Hant）。呼叫端負責過濾/選取要匯出的訂單。
 */
export function buildOrdersWorkbook(orders: OrderRow[]): Uint8Array<ArrayBuffer> {
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

  const cities = [...byCity.keys()].sort((a, b) =>
    a.localeCompare(b, "zh-Hant"),
  );

  const wb = XLSX.utils.book_new();
  for (const city of cities) {
    const aoa = [EXPORT_HEADER, ...byCity.get(city)!.map(orderToRow)];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, toSheetName(city));
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Uint8Array(buf);
}
