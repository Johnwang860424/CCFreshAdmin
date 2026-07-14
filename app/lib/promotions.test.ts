import { describe, expect, it } from "vitest";
import {
  calcLineSubtotal,
  getPromoStrategy,
  validatePromo,
} from "./promotions";

describe("second_item（第二件折扣）", () => {
  const promo = { type: "second_item", config: { discount: 80 } };

  it("每湊滿兩件其中一件打折，奇數件最後一件付原價", () => {
    // 單價 100、8 折：2 件 = 100 + 80
    expect(calcLineSubtotal(promo, 100, 2)).toBe(180);
    // 3 件 = 100*2 + 80
    expect(calcLineSubtotal(promo, 100, 3)).toBe(280);
    // 4 件 = 100*2 + 80*2
    expect(calcLineSubtotal(promo, 100, 4)).toBe(360);
    // 1 件不折
    expect(calcLineSubtotal(promo, 100, 1)).toBe(100);
  });

  it("折扣金額四捨五入到整數 NT$", () => {
    // 99 * 85% = 84.15 → 84
    expect(
      calcLineSubtotal({ type: "second_item", config: { discount: 85 } }, 99, 2),
    ).toBe(99 + 84);
  });

  it("describe 以折數慣例顯示（80 → 8 折、85 → 8.5 折）", () => {
    const s = getPromoStrategy("second_item")!;
    expect(s.describe({ discount: 80 })).toBe("第二件 8 折");
    expect(s.describe({ discount: 85 })).toBe("第二件 8.5 折");
  });
});

describe("bulk_avg_price（X 件以上均價）", () => {
  const promo = {
    type: "bulk_avg_price",
    config: { minQuantity: 3, avgPrice: 90 },
  };

  it("達門檻（含）後整筆每件以均價計", () => {
    expect(calcLineSubtotal(promo, 100, 3)).toBe(270);
    expect(calcLineSubtotal(promo, 100, 5)).toBe(450);
  });

  it("未達門檻退回原價 × 數量", () => {
    expect(calcLineSubtotal(promo, 100, 2)).toBe(200);
  });
});

describe("calcLineSubtotal 無優惠退回原價", () => {
  it("promo 為 null 或策略不存在時為 unitPrice × quantity", () => {
    expect(calcLineSubtotal(null, 50, 3)).toBe(150);
    expect(
      calcLineSubtotal({ type: "unknown_promo", config: {} }, 50, 3),
    ).toBe(150);
  });
});

describe("validatePromo", () => {
  it("type 為空視為無優惠（type/config 皆 null）", () => {
    expect(validatePromo(null, null)).toEqual({
      promoType: null,
      promoConfig: null,
    });
    expect(validatePromo("", { discount: 80 })).toEqual({
      promoType: null,
      promoConfig: null,
    });
  });

  it("未知或非字串 type 回錯誤", () => {
    expect(validatePromo("nope", {})).toEqual({ error: "無效的優惠方式" });
    expect(validatePromo(123, {})).toEqual({ error: "無效的優惠方式" });
  });

  it("欄位驗證：正規化為整數 config，超界回欄位錯誤訊息", () => {
    expect(validatePromo("second_item", { discount: "80" })).toEqual({
      promoType: "second_item",
      promoConfig: { discount: 80 },
    });
    expect(validatePromo("second_item", { discount: 0 })).toEqual({
      error: "第二件折數需為介於 1 ~ 99 的整數",
    });
    expect(validatePromo("second_item", { discount: 100 })).toEqual({
      error: "第二件折數需為介於 1 ~ 99 的整數",
    });
    expect(validatePromo("second_item", {})).toEqual({
      error: "第二件折數需為介於 1 ~ 99 的整數",
    });
  });
});
