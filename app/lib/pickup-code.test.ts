import { describe, expect, it } from "vitest";
import { formatPickupCode } from "./pickup-code";

describe("formatPickupCode", () => {
  it("FB 維持原格式：自取為「代碼＋流水號」、宅配為純數字", () => {
    expect(formatPickupCode("A", 5, "FB")).toBe("A5");
    expect(formatPickupCode("ABC", 12, "FB")).toBe("ABC12");
    expect(formatPickupCode(null, 7, "FB")).toBe("7");
  });

  it("Line 於代碼與流水號間加「L」", () => {
    expect(formatPickupCode("A", 5, "Line")).toBe("AL5");
    expect(formatPickupCode(null, 7, "Line")).toBe("L7");
  });

  it("網站於代碼與流水號間加「S」", () => {
    expect(formatPickupCode("A", 5, "網站")).toBe("AS5");
    expect(formatPickupCode(null, 7, "網站")).toBe("S7");
  });

  it("未知來源不加字母（同 FB 格式）", () => {
    expect(formatPickupCode("A", 5, "其他")).toBe("A5");
  });

  it("pickupNumber 為 null 時回傳 null（呼叫端顯示「-」）", () => {
    expect(formatPickupCode("A", null, "FB")).toBeNull();
    expect(formatPickupCode(null, null, "網站")).toBeNull();
  });
});
