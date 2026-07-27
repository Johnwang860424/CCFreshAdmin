// 訂單匯出：由 OrderRow[] 組裝 xlsx 活頁簿，兩種版面共用同一組欄位取值規則（欄位順序各自定義）。
// - buildOrdersWorkbook：依地點分頁，供分組匯出（app/api/orders/close）與選取匯出（app/api/orders/selection）共用。
// - buildAllOrdersWorkbook：單一分頁、依路線排序且各路線空一列，供一鍵匯出所有訂單（app/api/orders/export-all）。
import * as XLSX from "xlsx";
import type { OrderRow } from "@/app/lib/orders";
import { formatPickupCode } from "@/app/lib/pickup-code";

/** 依地點分頁匯出的欄位表頭（各分頁共用）。 */
const EXPORT_HEADER = [
  "取貨號",
  "客戶姓名",
  "取貨地點",
  "購買清單",
  "訂單總額",
  "聯絡電話",
  "備註",
  "來源",
];

/** 一鍵匯出所有訂單的欄位表頭（順序與上方不同，且不含「來源」）。 */
const ALL_EXPORT_HEADER = [
  "聯絡電話",
  "備註",
  "取貨號",
  "客戶姓名",
  "取貨地點",
  "購買清單",
  "訂單總額",
];

/**
 * 單筆訂單的各匯出欄位值（兩種版面共用同一份取值規則，只有欄位順序不同）。
 * `fullLocation`：自取的取貨地點是否帶完整「縣市 鄉鎮」——依縣市分頁時為 false（縣市已由分頁區分），
 * 全部訂單匯在同一頁時為 true（沒有分頁可區分縣市）。
 * 聯絡電話以文字保留，避免掉開頭 0（xlsx 字串即文字格）。
 */
function orderFields(order: OrderRow, fullLocation = false) {
  return {
    // 取貨號：站點代碼＋來源字母＋流水號（如 A5 / AL5 / AS5），與訂單管理頁顯示一致
    pickupCode:
      formatPickupCode(order.spotCode, order.pickupNumber, order.tag ?? "網站") ??
      "",
    customerName: order.customerName,
    // 取貨地點：自取帶入取貨點（鄉鎮或縣市 鄉鎮），宅配帶入收件地址
    location:
      order.deliveryMethod === "delivery"
        ? (order.shippingAddress ?? "")
        : ((fullLocation ? order.pickupSpotLabel : order.pickupSpotTownship) ??
          order.pickupSpotTownship ??
          ""),
    items: order.items
      .map((item) => `${item.productName}*${item.quantity}`)
      .join("/"),
    total: order.total,
    phone: order.phone ?? "",
    note: order.note ?? "",
    tag: order.tag ?? "網站",
  };
}

/** 單筆訂單轉為一列（EXPORT_HEADER 的欄位順序）。 */
function orderToRow(order: OrderRow): (string | number)[] {
  const f = orderFields(order);
  return [
    f.pickupCode,
    f.customerName,
    f.location,
    f.items,
    f.total,
    f.phone,
    f.note,
    f.tag,
  ];
}

/** 單筆訂單轉為一列（ALL_EXPORT_HEADER 的欄位順序）。 */
function orderToAllRow(order: OrderRow): (string | number)[] {
  const f = orderFields(order, true);
  return [
    f.phone,
    f.note,
    f.pickupCode,
    f.customerName,
    f.location,
    f.items,
    f.total,
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

/** 全部訂單匯出的路線分組（自取依路線、未分路線與宅配各自成組）。 */
interface RouteGroup {
  /** 排序鍵：一般路線用 route id，未分路線與宅配固定排在最後 */
  sortKey: number;
  orders: OrderRow[];
}

const UNASSIGNED_SORT_KEY = Number.MAX_SAFE_INTEGER - 1;
const DELIVERY_SORT_KEY = Number.MAX_SAFE_INTEGER;

/**
 * 由訂單陣列組裝「一鍵匯出所有訂單」的 xlsx 活頁簿並回傳位元組。
 * 單一工作表、欄位順序見 `ALL_EXPORT_HEADER`；訂單依路線分組排列
 * （一般路線依 route id 遞增，其後為未分路線，最後為宅配——與訂單管理路線下拉一致），
 * 每個路線之間空一列；組內維持傳入順序。
 */
export function buildAllOrdersWorkbook(
  orders: OrderRow[],
): Uint8Array<ArrayBuffer> {
  const groups = new Map<string, RouteGroup>();
  for (const order of orders) {
    const isDelivery = order.deliveryMethod === "delivery";
    const routeId = isDelivery ? null : order.routeId;
    const key = isDelivery ? "宅配" : routeId === null ? "未分路線" : `r${routeId}`;
    const sortKey = isDelivery
      ? DELIVERY_SORT_KEY
      : routeId === null
        ? UNASSIGNED_SORT_KEY
        : routeId;

    const group = groups.get(key);
    if (group) group.orders.push(order);
    else groups.set(key, { sortKey, orders: [order] });
  }

  const sorted = [...groups.values()].sort((a, b) => a.sortKey - b.sortKey);

  const aoa: (string | number)[][] = [ALL_EXPORT_HEADER];
  sorted.forEach((group, index) => {
    if (index > 0) aoa.push([]); // 路線之間空一列
    for (const order of group.orders) aoa.push(orderToAllRow(order));
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = autoFitCols(aoa);
  XLSX.utils.book_append_sheet(wb, ws, "所有訂單");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Uint8Array(buf);
}
