import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { OrderRow } from "@/app/domain/order-assembly";
import { buildAllOrdersWorkbook, buildOrdersWorkbook } from "./order-export";

const order = (overrides: Partial<OrderRow>): OrderRow => ({
  id: 1,
  customerName: "王小明",
  phone: "0912345678",
  deliveryMethod: "pickup",
  pickupSpotId: 3,
  pickupSpotLabel: "台中市 西區",
  pickupSpotCity: "台中市",
  pickupSpotTownship: "西區",
  routeId: 2,
  routeName: "山線",
  spotCode: "A",
  pickupNumber: 5,
  shippingAddress: null,
  note: null,
  total: 300,
  tag: "網站",
  createdAt: "2026-07-14T00:00:00Z",
  items: [
    {
      id: 11,
      orderId: 1,
      productId: 21,
      productName: "芒果",
      unitPrice: 100,
      quantity: 3,
      promoType: null,
      promoConfig: null,
      subtotal: 300,
    },
  ],
  ...overrides,
});

/** 讀回活頁簿，取出各分頁的 AOA（含表頭）。 */
function readBack(bytes: Uint8Array): Map<string, unknown[][]> {
  const wb = XLSX.read(bytes, { type: "array" });
  const sheets = new Map<string, unknown[][]>();
  for (const name of wb.SheetNames) {
    sheets.set(
      name,
      XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }) as unknown[][],
    );
  }
  return sheets;
}

describe("buildOrdersWorkbook", () => {
  it("依地點分頁：自取以取貨地點、宅配歸「宅配」、無地點歸「未分地點」", () => {
    const sheets = readBack(
      buildOrdersWorkbook([
        order({}),
        order({
          id: 2,
          deliveryMethod: "delivery",
          pickupSpotLabel: null,
          pickupSpotTownship: null,
          spotCode: null,
          pickupNumber: 7,
          shippingAddress: "台北市大安區和平東路 1 號",
        }),
        order({ id: 3, pickupSpotLabel: null, pickupSpotTownship: null }),
      ]),
    );

    expect([...sheets.keys()].sort()).toEqual(
      ["台中市 西區", "宅配", "未分地點"].sort(),
    );
  });

  it("列內容符合欄位契約：取貨號、地點欄位依取貨方式切換", () => {
    const sheets = readBack(
      buildOrdersWorkbook([
        order({ note: "備註文字" }),
        order({
          id: 2,
          customerName: "李小華",
          deliveryMethod: "delivery",
          pickupSpotLabel: null,
          pickupSpotTownship: null,
          spotCode: null,
          pickupNumber: 7,
          shippingAddress: "台北市大安區和平東路 1 號",
          phone: null,
          total: 60,
          items: [
            {
              id: 12,
              orderId: 2,
              productId: 22,
              productName: "鳳梨",
              unitPrice: 60,
              quantity: 1,
              promoType: null,
              promoConfig: null,
              subtotal: 60,
            },
          ],
        }),
      ]),
    );

    const pickup = sheets.get("台中市 西區")!;
    expect(pickup[0]).toEqual([
      "取貨號",
      "客戶姓名",
      "取貨地點",
      "購買清單",
      "訂單總額",
      "聯絡電話",
      "備註",
      "來源",
    ]);
    // 自取：取貨號＝站點代碼＋來源字母＋流水號（網站＝S）、地點＝鄉鎮
    expect(pickup[1]).toEqual([
      "AS5",
      "王小明",
      "西區",
      "芒果*3",
      300,
      "0912345678",
      "備註文字",
      "網站",
    ]);

    // 宅配：取貨號＝來源字母＋流水號（無站點代碼）、地點＝收件地址；空欄輸出為空
    const delivery = sheets.get("宅配")!;
    expect(delivery[1]).toEqual([
      "S7",
      "李小華",
      "台北市大安區和平東路 1 號",
      "鳳梨*1",
      60,
      "",
      "",
      "網站",
    ]);
  });

  it("多品項以「/」串接；分頁名稱移除 Excel 非法字元", () => {
    const sheets = readBack(
      buildOrdersWorkbook([
        order({
          pickupSpotLabel: "台中市 [西]區:測試",
          items: [
            {
              id: 11,
              orderId: 1,
              productId: 21,
              productName: "芒果",
              unitPrice: 100,
              quantity: 2,
              promoType: null,
              promoConfig: null,
              subtotal: 200,
            },
            {
              id: 12,
              orderId: 1,
              productId: 22,
              productName: "鳳梨",
              unitPrice: 60,
              quantity: 1,
              promoType: null,
              promoConfig: null,
              subtotal: 60,
            },
          ],
        }),
      ]),
    );
    const [name] = [...sheets.keys()];
    expect(name).toBe("台中市  西 區 測試");
    expect(sheets.get(name)![1][3]).toBe("芒果*2/鳳梨*1"); // 購買清單欄
  });

  it("匯出選取訂單保留傳入訂單的排序", () => {
    const sheets = readBack(
      buildOrdersWorkbook([
        order({ id: 1, customerName: "B" }),
        order({ id: 2, customerName: "E" }),
        order({ id: 3, customerName: "C" }),
        order({ id: 4, customerName: "A" }),
        order({ id: 5, customerName: "D" }),
      ]),
    );

    const sheet = sheets.get("台中市 西區")!;
    expect(sheet[1][1]).toBe("B");
    expect(sheet[2][1]).toBe("E");
    expect(sheet[3][1]).toBe("C");
    expect(sheet[4][1]).toBe("A");
    expect(sheet[5][1]).toBe("D");
  });
});

describe("buildAllOrdersWorkbook", () => {
  const delivery = (overrides: Partial<OrderRow> = {}): OrderRow =>
    order({
      deliveryMethod: "delivery",
      pickupSpotId: null,
      pickupSpotLabel: null,
      pickupSpotCity: null,
      pickupSpotTownship: null,
      routeId: null,
      routeName: null,
      spotCode: null,
      shippingAddress: "台北市大安區和平東路 1 號",
      ...overrides,
    });

  it("單一分頁：依路線排序（一般路線 → 未分路線 → 宅配），各路線之間空一列", () => {
    const sheets = readBack(
      buildAllOrdersWorkbook([
        delivery({ id: 1, customerName: "宅配一", pickupNumber: 7 }),
        order({ id: 2, customerName: "未分一", routeId: null, routeName: null }),
        order({ id: 3, customerName: "海線一", routeId: 5, routeName: "海線" }),
        order({ id: 4, customerName: "山線一", routeId: 2 }),
        order({ id: 5, customerName: "山線二", routeId: 2 }),
        order({ id: 6, customerName: "海線二", routeId: 5, routeName: "海線" }),
      ]),
    );

    expect([...sheets.keys()]).toEqual(["所有訂單"]);
    const rows = sheets.get("所有訂單")!;

    expect(rows[0][0]).toBe("聯絡電話");
    // 山線（route 2）→ 空列 → 海線（route 5）→ 空列 → 未分路線 → 空列 → 宅配
    expect(rows.map((r) => r[3] ?? "")).toEqual([
      "客戶姓名",
      "山線一",
      "山線二",
      "",
      "海線一",
      "海線二",
      "",
      "未分一",
      "",
      "宅配一",
    ]);
    expect(rows[3]).toEqual([]);
    expect(rows[6]).toEqual([]);
    expect(rows[8]).toEqual([]);
  });

  it("欄位順序為聯絡電話→備註→取貨號→客戶姓名→取貨地點→購買清單→訂單總額（無來源欄）", () => {
    const rows = readBack(
      buildAllOrdersWorkbook([
        order({ note: "備註文字" }),
        delivery({ id: 2, customerName: "李小華", pickupNumber: 7, phone: null }),
      ]),
    ).get("所有訂單")!;

    expect(rows[0]).toEqual([
      "聯絡電話",
      "備註",
      "取貨號",
      "客戶姓名",
      "取貨地點",
      "購買清單",
      "訂單總額",
    ]);
    // 自取：同一頁無縣市分頁，取貨地點帶完整「縣市 鄉鎮」
    expect(rows[1]).toEqual([
      "0912345678",
      "備註文字",
      "AS5",
      "王小明",
      "台中市 西區",
      "芒果*3",
      300,
    ]);
    // 宅配：取貨地點仍為收件地址；空欄輸出為空
    expect(rows[3]).toEqual([
      "",
      "",
      "S7",
      "李小華",
      "台北市大安區和平東路 1 號",
      "芒果*3",
      300,
    ]);
  });

  it("取貨點已刪除（無縣市）時退回鄉鎮/空字串，不影響分組", () => {
    const rows = readBack(
      buildAllOrdersWorkbook([
        order({ id: 1, pickupSpotLabel: null, pickupSpotTownship: null }),
      ]),
    ).get("所有訂單")!;

    expect(rows[1][4]).toBe(""); // 取貨地點欄
  });
});
