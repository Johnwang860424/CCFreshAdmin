import { describe, expect, it } from "vitest";
import { formatPickupCode } from "./pickup-code";

describe("formatPickupCode", () => {
  it("自取（有站點代碼）組成「代碼＋流水號」", () => {
    expect(formatPickupCode("A", 5)).toBe("A5");
    expect(formatPickupCode("ABC", 12)).toBe("ABC12");
  });

  it("宅配（無站點代碼）維持純數字", () => {
    expect(formatPickupCode(null, 7)).toBe("7");
  });

  it("pickupNumber 為 null 時回傳 null（呼叫端顯示「-」）", () => {
    expect(formatPickupCode("A", null)).toBeNull();
    expect(formatPickupCode(null, null)).toBeNull();
  });
});
