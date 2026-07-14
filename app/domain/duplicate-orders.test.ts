import { describe, expect, it } from "vitest";
import {
  countDuplicateOrders,
  duplicateNameKeys,
  orderKey,
  sortDuplicatesAdjacent,
} from "./duplicate-orders";

const order = (customerName: string) => ({ customerName });

describe("orderKey", () => {
  it("以 trim 後的姓名為鍵；空姓名回 null", () => {
    expect(orderKey(order(" 王小明 "))).toBe("王小明");
    expect(orderKey(order("  "))).toBeNull();
  });
});

describe("duplicateNameKeys", () => {
  it("僅出現超過一筆的姓名鍵入集合（電話不參與比對）", () => {
    const keys = duplicateNameKeys([
      order("王小明"),
      order(" 王小明"),
      order("李小華"),
    ]);
    expect(keys).toEqual(new Set(["王小明"]));
  });

  it("空姓名不參與判定", () => {
    expect(duplicateNameKeys([order(" "), order(" ")])).toEqual(new Set());
  });
});

describe("countDuplicateOrders", () => {
  it("以訂單計數（非客戶數）", () => {
    const orders = [
      order("王小明"),
      order("王小明"),
      order("王小明"),
      order("李小華"),
    ];
    expect(countDuplicateOrders(orders, duplicateNameKeys(orders))).toBe(3);
  });
});

describe("sortDuplicatesAdjacent", () => {
  it("以鍵首次出現於母體的索引為組序，組內維持原相對順序", () => {
    const population = [
      order("甲"),
      order("乙"),
      order("甲"),
      order("乙"),
      order("甲"),
    ];
    const filtered = [...population];
    const sorted = sortDuplicatesAdjacent(filtered, population);
    expect(sorted.map((o) => o.customerName)).toEqual([
      "甲",
      "甲",
      "甲",
      "乙",
      "乙",
    ]);
    // 不動輸入陣列
    expect(filtered.map((o) => o.customerName)).toEqual([
      "甲",
      "乙",
      "甲",
      "乙",
      "甲",
    ]);
  });
});
