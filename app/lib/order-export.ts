// 訂單匯出：由 OrderRow[] 組裝「依地點分頁」的 xlsx 活頁簿。
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

/** 字串顯示寬度：全形（CJK、全形符號）字算 2，其餘算 1。 */
function displayWidth(value: string | number): number {
  const s = String(value);
  let width = 0;
  for (const ch of s) {
    // 涵蓋 CJK 統一表意文字、注音、全形符號、假名等常見全形範圍
    width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(
      ch,
    )
      ? 2
      : 1;
  }
  return width;
}

/** 由列陣列計算各欄自適應寬度（!cols），寬度取該欄最長內容並加緩衝、上限 60。 */
function autoFitCols(aoa: (string | number)[][]): { wch: number }[] {
  const colCount = aoa.reduce((max, row) => Math.max(max, row.length), 0);
  const widths: { wch: number }[] = [];
  for (let c = 0; c < colCount; c++) {
    let max = 0;
    for (const row of aoa) {
      const cell = row[c];
      if (cell !== undefined && cell !== null) {
        max = Math.max(max, displayWidth(cell));
      }
    }
    widths.push({ wch: Math.min(max + 2, 60) });
  }
  return widths;
}

/** 地點 → 合法的 Excel 工作表名稱（≤31 字、不含 : \ / ? * [ ]，且不可空）。 */
function toSheetName(location: string): string {
  const cleaned = location.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31);
  return cleaned || "其他";
}

/**
 * 由訂單陣列組裝 xlsx 活頁簿並回傳位元組。
 * 依「地點」分成不同工作表（tab）：自取以取貨地點（縣市 + 鄉鎮）分頁、宅配歸「宅配」頁、
 * 自取無地點（取貨點已刪除）歸「未分地點」頁；分頁順序以地點名稱穩定排序（zh-Hant）。
 * 呼叫端負責過濾/選取要匯出的訂單。
 */
export function buildOrdersWorkbook(orders: OrderRow[]): Uint8Array<ArrayBuffer> {
  const byLocation = new Map<string, OrderRow[]>();
  for (const order of orders) {
    const location =
      order.deliveryMethod === "delivery"
        ? "宅配"
        : (order.pickupSpotLabel ?? "未分地點");
    const bucket = byLocation.get(location);
    if (bucket) bucket.push(order);
    else byLocation.set(location, [order]);
  }

  const locations = [...byLocation.keys()].sort((a, b) =>
    a.localeCompare(b, "zh-Hant"),
  );

  const wb = XLSX.utils.book_new();
  for (const location of locations) {
    const aoa = [EXPORT_HEADER, ...byLocation.get(location)!.map(orderToRow)];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = autoFitCols(aoa);
    XLSX.utils.book_append_sheet(wb, ws, toSheetName(location));
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Uint8Array(buf);
}
