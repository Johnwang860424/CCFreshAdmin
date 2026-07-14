import { describe, expect, it } from "vitest";
import { assembleOrders } from "./order-assembly";

const orderRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  customer_name: "王小明",
  phone: "0912345678",
  delivery_method: "pickup",
  pickup_spot_id: 3,
  pickup_spot_label: "台中市 西區",
  pickup_spot_city: "台中市",
  pickup_spot_township: "西區",
  route_id: 2,
  route_name: "山線",
  spot_code: "A",
  pickup_number: 5,
  shipping_address: null,
  note: null,
  total: 300,
  tag: "網站",
  created_at: "2026-07-14T00:00:00Z",
  ...overrides,
});

describe("assembleOrders", () => {
  it("將 snake_case 訂單列轉為 OrderRow，明細掛回各自訂單", () => {
    const orders = assembleOrders(
      [orderRow(), orderRow({ id: 2, customer_name: "李小華" })],
      [
        {
          id: 11,
          order_id: 1,
          product_id: 21,
          product_name: "芒果",
          unit_price: 100,
          quantity: 3,
          promo_type: null,
          promo_config: null,
          subtotal: 300,
        },
        {
          id: 12,
          order_id: 2,
          product_id: 22,
          product_name: "鳳梨",
          unit_price: 60,
          quantity: 1,
          promo_type: "second_item",
          promo_config: { discount: 80 },
          subtotal: 60,
        },
      ],
    );

    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({
      id: 1,
      customerName: "王小明",
      pickupSpotLabel: "台中市 西區",
      routeId: 2,
      spotCode: "A",
      pickupNumber: 5,
    });
    expect(orders[0].items).toEqual([
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
    ]);
    expect(orders[1].items[0].promoConfig).toEqual({ discount: 80 });
  });

  it("無明細的訂單 items 為空陣列；缺欄位補 null、tag 預設「網站」", () => {
    const [order] = assembleOrders(
      [
        orderRow({
          phone: null,
          pickup_spot_label: null,
          route_id: null,
          route_name: null,
          spot_code: null,
          pickup_number: null,
          tag: null,
        }),
      ],
      [],
    );
    expect(order.items).toEqual([]);
    expect(order.phone).toBeNull();
    expect(order.routeId).toBeNull();
    expect(order.tag).toBe("網站");
  });
});
