import { describe, expect, it } from "vitest";
import { stockInsufficiencyMessage } from "./stock";

describe("stockInsufficiencyMessage", () => {
  it("庫存足夠或不限量（null）回 null", () => {
    expect(
      stockInsufficiencyMessage(
        [
          { id: 1, name: "芒果", stock: 5 },
          { id: 2, name: "鳳梨", stock: null },
        ],
        new Map([
          [1, 5],
          [2, 999],
        ]),
      ),
    ).toBeNull();
  });

  it("不足時依 SC-003 契約組訊息，多筆以「；」併列", () => {
    expect(
      stockInsufficiencyMessage(
        [
          { id: 1, name: "芒果", stock: 2 },
          { id: 2, name: "鳳梨", stock: 0 },
          { id: 3, name: "香蕉", stock: 10 },
        ],
        new Map([
          [1, 3],
          [2, 1],
          [3, 10],
        ]),
      ),
    ).toBe("「芒果」庫存不足（剩餘 2）；「鳳梨」庫存不足（剩餘 0）");
  });

  it("未被需求的商品不檢查", () => {
    expect(
      stockInsufficiencyMessage([{ id: 1, name: "芒果", stock: 0 }], new Map()),
    ).toBeNull();
  });
});
