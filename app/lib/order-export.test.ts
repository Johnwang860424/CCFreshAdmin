import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { OrderRow } from "@/app/domain/order-assembly";
import { buildOrdersWorkbook } from "./order-export";

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
